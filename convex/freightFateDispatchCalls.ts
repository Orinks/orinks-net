import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { boardListing, driverTokenAccepted } from "./freightFate";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import {
  normalizeFreightFateDispatchCallFacts,
  type FreightFateDispatchCallFacts,
} from "./freightFateRequest";

export const DISPATCH_CALL_RING_MS = 60_000;
export const DISPATCH_CALL_ANSWER_MS = 90_000;
export const DISPATCH_CALL_RETENTION_MS = 24 * 60 * 60_000;
export const DISPATCH_CALL_WRITE_LIMIT = 10;
export const DISPATCH_CALL_READ_LIMIT = 60;
export const DISPATCH_CALL_CLEANUP_BATCH = 200;
export const DISPATCH_CALL_OPEN_SCAN = 100;

export const DISPATCH_CALL_DECISIONS = {
  delay: ["continue", "watch", "late_update"],
  hours: ["plan_rest", "stop"],
  road_conditions: ["continue", "caution"],
  truck_trouble: ["monitor", "repair_authorized"],
  load_trouble: ["continue", "protect_load"],
} as const;

type CallKind = keyof typeof DISPATCH_CALL_DECISIONS;
type Failure = { ok: false; reason: string };
type Success = { ok: true; [key: string]: unknown };
type CallReply = Failure | Success;

const OPEN_STATUSES = ["ringing", "claimed"] as const;

function isCallKind(value: string): value is CallKind {
  return Object.hasOwn(DISPATCH_CALL_DECISIONS, value);
}

function isDecision(kind: string, decision: string) {
  return (
    isCallKind(kind) &&
    (DISPATCH_CALL_DECISIONS[kind] as readonly string[]).includes(decision)
  );
}

function newCallId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function driverById(ctx: QueryCtx, driverId: string) {
  return await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .unique();
}

async function authorizedDriver(
  ctx: QueryCtx,
  driver: Doc<"freightFateDrivers">,
  driverTokenHash: string,
) {
  if (!(await driverTokenAccepted(ctx, driver, driverTokenHash))) {
    return { ok: false as const, reason: "unauthorized" };
  }

  const listing = boardListing(driver);
  if (!listing.listed) {
    return { ok: false as const, reason: "not_listed" };
  }

  return { ok: true as const, displayName: listing.displayName };
}

async function authorizeWrite(
  ctx: MutationCtx,
  args: { driverId: string; driverTokenHash: string; now: number },
  scope: string,
  limit = DISPATCH_CALL_WRITE_LIMIT,
) {
  const driver = await driverById(ctx, args.driverId);
  if (!driver) {
    return { ok: false as const, reason: "driver_not_found" };
  }

  const allowed = await consumeFreightFateWrite(ctx, {
    scope,
    driverId: args.driverId,
    now: args.now,
    limit,
  });
  if (!allowed) {
    return { ok: false as const, reason: "rate_limited" };
  }

  return await authorizedDriver(ctx, driver, args.driverTokenHash);
}

async function findCall(ctx: QueryCtx, id: string) {
  return await ctx.db
    .query("freightFateDispatchCalls")
    .withIndex("by_call_id", (q) => q.eq("callId", id))
    .unique();
}

async function expireIfNeeded(
  ctx: MutationCtx,
  call: Doc<"freightFateDispatchCalls">,
  now: number,
) {
  if (
    (call.status === "ringing" && now >= call.ringUntil) ||
    (call.status === "claimed" && call.answerBy !== undefined && now >= call.answerBy)
  ) {
    await ctx.db.patch(call._id, { status: "expired" });
    return { ...call, status: "expired" as const };
  }

  return call;
}

async function cancelOtherOpenCalls(
  ctx: MutationCtx,
  callerDriverId: string,
  now: number,
) {
  for (const status of OPEN_STATUSES) {
    const calls = await ctx.db
      .query("freightFateDispatchCalls")
      .withIndex("by_caller_status", (q) =>
        q.eq("callerDriverId", callerDriverId).eq("status", status),
      )
      .collect();

    for (const call of calls) {
      const current = await expireIfNeeded(ctx, call, now);
      if (current.status === "ringing" || current.status === "claimed") {
        await ctx.db.patch(current._id, { status: "cancelled" });
      }
    }
  }
}

export const create = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    requestId: v.string(),
    kind: v.string(),
    facts: v.any(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(ctx, args, "dispatch-call-create");
    if (!authorization.ok) {
      return authorization;
    }

    const requestId = args.requestId.trim();
    if (!requestId || requestId.length > 96) {
      return { ok: false, reason: "invalid_request_id" };
    }
    if (!isCallKind(args.kind)) {
      return { ok: false, reason: "unsupported_kind" };
    }

    let facts: FreightFateDispatchCallFacts;
    try {
      facts = normalizeFreightFateDispatchCallFacts(args.facts);
    } catch {
      return { ok: false, reason: "invalid_facts" };
    }

    const existing = await ctx.db
      .query("freightFateDispatchCalls")
      .withIndex("by_caller_request", (q) =>
        q.eq("callerDriverId", args.driverId).eq("requestId", requestId),
      )
      .unique();
    if (existing) {
      await expireIfNeeded(ctx, existing, args.now);
      return { ok: true, callId: existing.callId, ringUntil: existing.ringUntil };
    }

    await cancelOtherOpenCalls(ctx, args.driverId, args.now);
    const id = newCallId();
    const ringUntil = args.now + DISPATCH_CALL_RING_MS;
    await ctx.db.insert("freightFateDispatchCalls", {
      callId: id,
      requestId,
      callerDriverId: args.driverId,
      callerName: authorization.displayName,
      kind: args.kind,
      facts,
      status: "ringing",
      createdAt: args.now,
      ringUntil,
    });

    return { ok: true, callId: id, ringUntil };
  },
});

export const status = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    callId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(
      ctx,
      args,
      "dispatch-call-status",
      DISPATCH_CALL_READ_LIMIT,
    );
    if (!authorization.ok) {
      return authorization;
    }

    const call = await findCall(ctx, args.callId);
    if (!call || call.callerDriverId !== args.driverId) {
      return { ok: false, reason: "call_not_found" };
    }

    const current = await expireIfNeeded(ctx, call, args.now);
    return {
      ok: true,
      status: current.status,
      ...(current.responderName === undefined ? {} : { responderName: current.responderName }),
      ...(current.decision === undefined ? {} : { decision: current.decision }),
    };
  },
});

export const open = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(
      ctx,
      args,
      "dispatch-call-open",
      DISPATCH_CALL_READ_LIMIT,
    );
    if (!authorization.ok) {
      return authorization;
    }

    const candidates = await ctx.db
      .query("freightFateDispatchCalls")
      .withIndex("by_status_created", (q) => q.eq("status", "ringing"))
      .order("desc")
      .take(DISPATCH_CALL_OPEN_SCAN);
    const calls: Array<{
      callId: string;
      callerName: string;
      kind: CallKind;
      facts: FreightFateDispatchCallFacts;
      ringUntil: number;
    }> = [];

    for (const call of candidates) {
      const current = await expireIfNeeded(ctx, call, args.now);
      if (current.status !== "ringing" || current.callerDriverId === args.driverId) {
        continue;
      }

      const caller = await driverById(ctx, current.callerDriverId);
      if (!caller) {
        continue;
      }
      const listing = boardListing(caller);
      if (!listing.listed) {
        continue;
      }

      calls.push({
        callId: current.callId,
        callerName: listing.displayName,
        kind: current.kind,
        facts: current.facts,
        ringUntil: current.ringUntil,
      });
      if (calls.length === 5) {
        break;
      }
    }

    return { ok: true, calls };
  },
});

export const claim = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    callId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(ctx, args, "dispatch-call-claim");
    if (!authorization.ok) {
      return authorization;
    }

    const call = await findCall(ctx, args.callId);
    if (!call) {
      return { ok: false, reason: "call_not_found" };
    }

    const current = await expireIfNeeded(ctx, call, args.now);
    if (current.status === "expired") {
      return { ok: false, reason: "expired" };
    }
    if (current.callerDriverId === args.driverId) {
      return { ok: false, reason: "own_call" };
    }
    if (current.status !== "ringing") {
      return { ok: false, reason: "taken" };
    }

    const activeClaims = await ctx.db
      .query("freightFateDispatchCalls")
      .withIndex("by_responder_status", (q) =>
        q.eq("responderDriverId", args.driverId).eq("status", "claimed"),
      )
      .collect();
    for (const active of activeClaims) {
      const currentClaim = await expireIfNeeded(ctx, active, args.now);
      if (currentClaim.status === "claimed") {
        return { ok: false, reason: "busy" };
      }
    }

    await ctx.db.patch(current._id, {
      status: "claimed",
      responderDriverId: args.driverId,
      responderName: authorization.displayName,
      claimedAt: args.now,
      answerBy: args.now + DISPATCH_CALL_ANSWER_MS,
    });
    return { ok: true };
  },
});

export const answer = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    callId: v.string(),
    decision: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(ctx, args, "dispatch-call-answer");
    if (!authorization.ok) {
      return authorization;
    }

    const call = await findCall(ctx, args.callId);
    if (!call) {
      return { ok: false, reason: "call_not_found" };
    }
    const current = await expireIfNeeded(ctx, call, args.now);
    if (current.status === "expired") {
      return { ok: false, reason: "expired" };
    }
    if (current.status !== "claimed") {
      return { ok: false, reason: "not_claimed" };
    }
    if (current.responderDriverId !== args.driverId) {
      return { ok: false, reason: "not_responder" };
    }
    if (!isDecision(current.kind, args.decision)) {
      return { ok: false, reason: "invalid_decision" };
    }

    await ctx.db.patch(current._id, {
      status: "answered",
      decision: args.decision,
      answeredAt: args.now,
    });
    return { ok: true };
  },
});

export const cancel = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    callId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CallReply> => {
    const authorization = await authorizeWrite(ctx, args, "dispatch-call-cancel");
    if (!authorization.ok) {
      return authorization;
    }

    const call = await findCall(ctx, args.callId);
    if (!call || call.callerDriverId !== args.driverId) {
      return { ok: false, reason: "call_not_found" };
    }
    const current = await expireIfNeeded(ctx, call, args.now);
    if (current.status === "ringing" || current.status === "claimed") {
      await ctx.db.patch(current._id, { status: "cancelled" });
    }
    return { ok: true };
  },
});

export const cleanupDispatchCalls = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("freightFateDispatchCalls")
      .withIndex("by_created", (q) =>
        q.lt("createdAt", now - DISPATCH_CALL_RETENTION_MS),
      )
      .take(DISPATCH_CALL_CLEANUP_BATCH);

    for (const call of expired) {
      await ctx.db.delete(call._id);
    }

    return {
      deleted: expired.length,
      moreWaiting: expired.length === DISPATCH_CALL_CLEANUP_BATCH,
    };
  },
});
