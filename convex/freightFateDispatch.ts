// Live dispatch: a Dispatch player runs a carrier on orinks.net, Freight Fate
// players join it by invite code, and the dispatcher routes them through a
// mailbox of orders (desk to truck) and replies (truck to desk).
//
// Nobody has to be online at the same time. Every order is a standing order
// until it is answered or expires (in real time), every truck keeps its last
// known state on the member row, and the night desk below offers a load to a
// signed-on, empty driver whose queue ran dry. The games keep their own
// clocks; nothing here ever waits on one.
//
// Every call takes the same driver token the games already send. The whole
// feature answers not_enabled until FREIGHT_FATE_LIVE_DISPATCH turns it on
// (see liveDispatchEnabled). Design: "Freight Fate: live dispatch",
// 2026-11-11.
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import { acceptDriverToken, PAUSED_ACTIVITY, PRESENCE_TTL_MS } from "./freightFate";
import { isNameBlocked, maskDisplayName } from "./moderation";
import {
  activeMembership,
  liveDispatchAudience,
  liveDispatchEnabled,
} from "./freightFateDispatchTruck";

// --- Limits and clocks (all real time) ---

// Writes a dispatcher can make in an hour: orders, withdrawals, settings.
export const DISPATCH_DESK_HOURLY_LIMIT = 240;
// Replies one driver can post in an hour.
export const DISPATCH_REPLY_HOURLY_LIMIT = 240;
// Join, leave and other one-off calls, per minute. Low enough that guessing
// invite codes is hopeless: 32^8 codes at thirty a minute.
export const DISPATCH_MISC_MINUTE_LIMIT = 30;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

// A load offer's pickup window when the desk names none, and its bounds.
export const LOAD_OFFER_DEFAULT_MS = DAY_MS;
const LOAD_OFFER_MIN_MS = 10 * 60_000;
// Go home, notes and routes not tied to a load.
export const ORDER_DEFAULT_MS = 7 * DAY_MS;
// Once accepted, a load has this long to deliver before the desk hears it
// went quiet.
export const ACCEPTED_LOAD_MS = 14 * DAY_MS;
// Closed orders and heard replies are dropped after this.
export const DISPATCH_RETENTION_MS = 30 * DAY_MS;
// The night desk will not offer the same driver a second load sooner.
export const NIGHT_DESK_COOLDOWN_MS = 30 * 60_000;
export const NIGHT_DESK_PICKUP_MS = DAY_MS;

export const MAX_LANES = 40;
export const MAX_REPLIES_PER_READ = 100;
const CRON_BATCH = 200;

// --- Small helpers ---

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return toHex(out);
}

// No 0/O, 1/I: the dispatcher reads it aloud and the driver types it.
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function mintInviteCode() {
  const out = new Uint8Array(8);
  crypto.getRandomValues(out);
  return Array.from(out, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

export function normalizeInviteCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

class Refusal extends Error {
  constructor(readonly reason: string, readonly field?: string) {
    super(reason);
  }
}

function refuse(reason: string, field?: string): never {
  throw new Refusal(reason, field);
}

/** Run a handler, turning a Refusal into an { ok: false } answer.
 *
 * A thrown Refusal never reaches a database write that follows it, and a
 * Convex mutation that returns normally still commits what ran before the
 * throw -- so every handler refuses before it writes anything.
 */
async function answer<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) {
      return { ok: false as const, reason: error.reason, ...(error.field ? { field: error.field } : {}) };
    }
    throw error;
  }
}

function text(value: unknown, field: string, max: number, required: true): string;
function text(value: unknown, field: string, max: number, required?: false): string | undefined;
function text(value: unknown, field: string, max: number, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) refuse("invalid_payload", field);
    return undefined;
  }
  if (typeof value !== "string") refuse("invalid_payload", field);
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
  if (!cleaned) {
    if (required) refuse("invalid_payload", field);
    return undefined;
  }
  return cleaned;
}

function screened(value: unknown, field: string, max: number, required: true): string;
function screened(value: unknown, field: string, max: number, required?: false): string | undefined;
function screened(value: unknown, field: string, max: number, required = false) {
  const cleaned = required ? text(value, field, max, true) : text(value, field, max);
  if (cleaned && isNameBlocked(cleaned)) refuse("text_blocked", field);
  return cleaned;
}

function num(value: unknown, field: string, min: number, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    refuse("invalid_payload", field);
  }
  return value;
}

function bool(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") refuse("invalid_payload", field);
  return value;
}

function compact<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined)) as T;
}

function sameCity(a: string | undefined, b: string | undefined) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// --- Authentication ---

type Auth = { driverId: string; driverTokenHash: string; now: number };
const authArgs = { driverId: v.string(), driverTokenHash: v.string(), now: v.number() };

async function signedInWriter(
  ctx: MutationCtx,
  args: Auth,
  limit: { scope: string; limit: number; windowMs?: number },
) {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
    .unique();
  if (!driver) refuse("driver_not_found");
  if (!liveDispatchEnabled(driver.driverId)) refuse("not_enabled");
  const allowed = await consumeFreightFateWrite(ctx, {
    scope: limit.scope,
    driverId: driver.driverId,
    now: args.now,
    limit: limit.limit,
    windowMs: limit.windowMs,
  });
  if (!allowed) refuse("rate_limited");
  if (!(await acceptDriverToken(ctx, driver, args.driverTokenHash)).accepted) refuse("unauthorized");
  return driver;
}

async function signedInReader(ctx: QueryCtx, args: Auth) {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
    .unique();
  if (!driver) refuse("driver_not_found");
  if (!liveDispatchEnabled(driver.driverId)) refuse("not_enabled");
  if (!(await acceptDriverToken(ctx, driver, args.driverTokenHash)).accepted) refuse("unauthorized");
  return driver;
}

const MISC = { scope: "dispatch", limit: DISPATCH_MISC_MINUTE_LIMIT };
const DESK = { scope: "dispatch-desk", limit: DISPATCH_DESK_HOURLY_LIMIT, windowMs: HOUR_MS };
const REPLY = { scope: "dispatch-reply", limit: DISPATCH_REPLY_HOURLY_LIMIT, windowMs: HOUR_MS };

async function ownedCarrier(ctx: QueryCtx, ownerDriverId: string) {
  const rows = await ctx.db
    .query("freightFateCarriers")
    .withIndex("by_owner", (q) => q.eq("ownerDriverId", ownerDriverId))
    .collect();
  return rows.find((row) => row.closedAt === undefined) ?? null;
}

async function carrierById(ctx: QueryCtx, carrierId: string) {
  return await ctx.db
    .query("freightFateCarriers")
    .withIndex("by_carrier_id", (q) => q.eq("carrierId", carrierId))
    .unique();
}

async function deskCarrier(ctx: QueryCtx, ownerDriverId: string) {
  const carrier = await ownedCarrier(ctx, ownerDriverId);
  if (!carrier) refuse("no_carrier");
  return carrier;
}

async function memberOf(ctx: QueryCtx, carrierId: string, driverId: string) {
  const member = await activeMembership(ctx, driverId);
  if (!member || member.carrierId !== carrierId) refuse("not_a_member");
  return member;
}

// --- Carrier settings ---

type Lane = Doc<"freightFateCarriers">["lanes"][number];

function cleanLanes(value: unknown): Lane[] {
  if (!Array.isArray(value)) refuse("invalid_payload", "lanes");
  if (value.length > MAX_LANES) refuse("invalid_payload", "lanes");
  return value.map((lane, index) => {
    if (!lane || typeof lane !== "object") refuse("invalid_payload", `lanes.${index}`);
    const raw = lane as Record<string, unknown>;
    return compact({
      origin: text(raw.origin, `lanes.${index}.origin`, 80),
      destination: text(raw.destination, `lanes.${index}.destination`, 80, true),
      cargo: text(raw.cargo, `lanes.${index}.cargo`, 80),
    });
  });
}

async function uniqueInviteCode(ctx: QueryCtx) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = mintInviteCode();
    const taken = await ctx.db
      .query("freightFateCarriers")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .first();
    if (!taken) return code;
  }
  throw new Error("Could not mint a free invite code.");
}

async function tellDesk(
  ctx: MutationCtx,
  row: { carrierId: string; driverId: string; kind: string; orderId?: string; payload?: unknown; now: number },
) {
  await ctx.db.insert("freightFateDispatchReplies", {
    replyId: `srv_${randomHex(12)}`,
    ...(row.orderId ? { orderId: row.orderId } : {}),
    carrierId: row.carrierId,
    driverId: row.driverId,
    kind: row.kind,
    source: "server",
    payload: row.payload ?? {},
    createdAt: row.now,
  });
}

export const createCarrier = mutation({
  args: {
    ...authArgs,
    name: v.string(),
    homeTerminal: v.string(),
    secondTerminal: v.optional(v.string()),
    nightDispatcherDefault: v.optional(v.boolean()),
    lanes: v.optional(v.any()),
  },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, MISC);
    const existing = await ownedCarrier(ctx, driver.driverId);
    if (existing) {
      return { ok: true as const, created: false, carrierId: existing.carrierId, inviteCode: existing.inviteCode };
    }
    const name = screened(args.name, "name", 60, true);
    const homeTerminal = text(args.homeTerminal, "homeTerminal", 80, true);
    const secondTerminal = text(args.secondTerminal, "secondTerminal", 80);
    const lanes = args.lanes === undefined ? [] : cleanLanes(args.lanes);
    const carrierId = `car_${randomHex(8)}`;
    const inviteCode = await uniqueInviteCode(ctx);
    await ctx.db.insert("freightFateCarriers", {
      carrierId,
      ownerDriverId: driver.driverId,
      name,
      homeTerminal,
      ...(secondTerminal ? { secondTerminal } : {}),
      inviteCode,
      nightDispatcherDefault: args.nightDispatcherDefault ?? true,
      lanes,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { ok: true as const, created: true, carrierId, inviteCode };
  }),
});

export const updateCarrier = mutation({
  args: {
    ...authArgs,
    name: v.optional(v.string()),
    homeTerminal: v.optional(v.string()),
    secondTerminal: v.optional(v.union(v.string(), v.null())),
    nightDispatcherDefault: v.optional(v.boolean()),
    lanes: v.optional(v.any()),
    newInviteCode: v.optional(v.boolean()),
  },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const patch: Partial<Doc<"freightFateCarriers">> = { updatedAt: args.now };
    if (args.name !== undefined) patch.name = screened(args.name, "name", 60, true);
    if (args.homeTerminal !== undefined) patch.homeTerminal = text(args.homeTerminal, "homeTerminal", 80, true);
    if (args.secondTerminal !== undefined) {
      patch.secondTerminal = args.secondTerminal === null ? undefined : text(args.secondTerminal, "secondTerminal", 80);
    }
    if (args.nightDispatcherDefault !== undefined) patch.nightDispatcherDefault = args.nightDispatcherDefault;
    if (args.lanes !== undefined) patch.lanes = cleanLanes(args.lanes);
    if (args.newInviteCode) patch.inviteCode = await uniqueInviteCode(ctx);
    await ctx.db.patch(carrier._id, patch);
    return { ok: true as const, carrierId: carrier.carrierId, inviteCode: patch.inviteCode ?? carrier.inviteCode };
  }),
});

/** Close every open order a driver holds with this carrier. */
async function clearQueue(ctx: MutationCtx, carrierId: string, driverId: string, now: number) {
  for (const status of ["open", "accepted"] as const) {
    const orders = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_driver_status", (q) => q.eq("driverId", driverId).eq("status", status))
      .collect();
    for (const order of orders) {
      if (order.carrierId === carrierId) {
        await ctx.db.patch(order._id, { status: "withdrawn", closedAt: now });
      }
    }
  }
}

async function endStint(
  ctx: MutationCtx,
  member: Doc<"freightFateCarrierMembers">,
  reason: "left" | "released" | "carrier_closed",
  now: number,
) {
  await ctx.db.patch(member._id, { leftAt: now, leftReason: reason });
  await clearQueue(ctx, member.carrierId, member.driverId, now);
}

export const closeCarrier = mutation({
  args: authArgs,
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, MISC);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const members = await ctx.db
      .query("freightFateCarrierMembers")
      .withIndex("by_carrier", (q) => q.eq("carrierId", carrier.carrierId).eq("leftAt", undefined))
      .collect();
    for (const member of members) await endStint(ctx, member, "carrier_closed", args.now);
    await ctx.db.patch(carrier._id, { closedAt: args.now, updatedAt: args.now });
    return { ok: true as const, released: members.length };
  }),
});

// --- Joining and leaving ---

export const joinCarrier = mutation({
  args: { ...authArgs, inviteCode: v.string() },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, MISC);
    const code = normalizeInviteCode(args.inviteCode);
    const carrier = code.length === 8
      ? await ctx.db
        .query("freightFateCarriers")
        .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
        .first()
      : null;
    if (!carrier || carrier.closedAt !== undefined) refuse("invite_not_found");
    const current = await activeMembership(ctx, driver.driverId);
    if (current?.carrierId === carrier.carrierId) {
      return { ok: true as const, joined: false, carrierId: carrier.carrierId, carrierName: carrier.name };
    }
    // One carrier per driver; switching is leave, then join.
    if (current) refuse("already_in_carrier");
    await ctx.db.insert("freightFateCarrierMembers", {
      carrierId: carrier.carrierId,
      driverId: driver.driverId,
      joinedAt: args.now,
      standingRules: {},
    });
    await tellDesk(ctx, { carrierId: carrier.carrierId, driverId: driver.driverId, kind: "joined", now: args.now });
    return { ok: true as const, joined: true, carrierId: carrier.carrierId, carrierName: carrier.name };
  }),
});

export const leaveCarrier = mutation({
  args: authArgs,
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, MISC);
    const member = await activeMembership(ctx, driver.driverId);
    if (!member) return { ok: true as const, left: false };
    await endStint(ctx, member, "left", args.now);
    await tellDesk(ctx, { carrierId: member.carrierId, driverId: driver.driverId, kind: "left", now: args.now });
    return { ok: true as const, left: true };
  }),
});

/** The driver's own switches: mute the desk's notes. */
export const setMySettings = mutation({
  args: { ...authArgs, notesMuted: v.optional(v.boolean()) },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, MISC);
    const member = await activeMembership(ctx, driver.driverId);
    if (!member) refuse("not_a_member");
    if (args.notesMuted !== undefined) {
      await ctx.db.patch(member._id, { notesMuted: args.notesMuted });
      if (args.notesMuted) {
        const open = await ctx.db
          .query("freightFateDispatchOrders")
          .withIndex("by_driver_status", (q) => q.eq("driverId", driver.driverId).eq("status", "open"))
          .collect();
        for (const order of open) {
          if (order.kind === "note") await ctx.db.patch(order._id, { status: "withdrawn", closedAt: args.now });
        }
      }
    }
    return { ok: true as const };
  }),
});

export const releaseDriver = mutation({
  args: { ...authArgs, memberDriverId: v.string() },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const member = await memberOf(ctx, carrier.carrierId, args.memberDriverId);
    await endStint(ctx, member, "released", args.now);
    return { ok: true as const };
  }),
});

export const setMemberSettings = mutation({
  args: {
    ...authArgs,
    memberDriverId: v.string(),
    // null puts the driver back on the carrier default.
    nightDispatcher: v.optional(v.union(v.boolean(), v.null())),
    standingRules: v.optional(v.any()),
  },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const member = await memberOf(ctx, carrier.carrierId, args.memberDriverId);
    const patch: Partial<Doc<"freightFateCarrierMembers">> = {};
    if (args.nightDispatcher !== undefined) {
      patch.nightDispatcher = args.nightDispatcher === null ? undefined : args.nightDispatcher;
    }
    if (args.standingRules !== undefined) {
      const raw = (args.standingRules ?? {}) as Record<string, unknown>;
      if (typeof raw !== "object") refuse("invalid_payload", "standingRules");
      patch.standingRules = compact({
        fuelChain: text(raw.fuelChain, "standingRules.fuelChain", 60),
        noNightDriving: bool(raw.noNightDriving, "standingRules.noNightDriving"),
        homeBy: text(raw.homeBy, "standingRules.homeBy", 60),
      });
    }
    await ctx.db.patch(member._id, patch);
    return { ok: true as const };
  }),
});

// --- Orders (desk to truck) ---

type OrderKind = Doc<"freightFateDispatchOrders">["kind"];

/** Validate a desk order's payload and work out when it expires. */
function cleanOrder(kind: OrderKind, raw: Record<string, unknown>, now: number) {
  switch (kind) {
    case "load_offer": {
      const pickupBy = num(raw.pickupBy, "pickupBy", now + LOAD_OFFER_MIN_MS, now + ORDER_DEFAULT_MS);
      const expiresAt = pickupBy ?? now + LOAD_OFFER_DEFAULT_MS;
      return {
        expiresAt,
        payload: compact({
          // Freight Fate builds the job from this seed at the driver's
          // location, the way Dispatch builds its board, so the two games
          // agree on pay, distance and cargo without shipping the job.
          jobSeed: text(raw.jobSeed, "jobSeed", 64, true),
          origin: text(raw.origin, "origin", 80, true),
          destination: text(raw.destination, "destination", 80, true),
          cargo: text(raw.cargo, "cargo", 80),
          // Dollars, as both games show them.
          pay: num(raw.pay, "pay", 0, 1_000_000),
          miles: num(raw.miles, "miles", 0, 10_000),
          // The delivery appointment as spoken, in the driver's game time.
          appointment: text(raw.appointment, "appointment", 80),
          routeName: text(raw.routeName, "routeName", 80),
          fuelStop: text(raw.fuelStop, "fuelStop", 80),
          pickupBy: expiresAt,
        }),
      };
    }
    case "route":
      return {
        expiresAt: now + ACCEPTED_LOAD_MS,
        payload: compact({
          loadOrderId: text(raw.loadOrderId, "loadOrderId", 96),
          routeName: text(raw.routeName, "routeName", 80, true),
          fuelStop: text(raw.fuelStop, "fuelStop", 80),
        }),
      };
    case "go_home":
      return {
        expiresAt: now + ORDER_DEFAULT_MS,
        payload: compact({
          terminal: text(raw.terminal, "terminal", 80, true),
          // Spoken, in game time ("Friday night").
          byWhen: text(raw.byWhen, "byWhen", 60),
        }),
      };
    case "note":
      return {
        expiresAt: now + ORDER_DEFAULT_MS,
        payload: { text: screened(raw.text, "text", 280, true) },
      };
  }
}

export const postOrder = mutation({
  args: {
    ...authArgs,
    orderId: v.string(),
    memberDriverId: v.string(),
    kind: v.union(v.literal("load_offer"), v.literal("route"), v.literal("go_home"), v.literal("note")),
    payload: v.any(),
  },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const orderId = text(args.orderId, "orderId", 96, true);
    const existing = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_order_id", (q) => q.eq("orderId", orderId))
      .unique();
    if (existing) {
      if (existing.carrierId !== carrier.carrierId) refuse("order_id_taken");
      return { ok: true as const, duplicate: true, orderId, status: existing.status, expiresAt: existing.expiresAt };
    }
    const member = await memberOf(ctx, carrier.carrierId, args.memberDriverId);
    if (args.kind === "note" && member.notesMuted) refuse("notes_muted");
    if (!args.payload || typeof args.payload !== "object") refuse("invalid_payload", "payload");
    const { payload, expiresAt } = cleanOrder(args.kind, args.payload as Record<string, unknown>, args.now);
    await ctx.db.insert("freightFateDispatchOrders", {
      orderId,
      carrierId: carrier.carrierId,
      driverId: member.driverId,
      kind: args.kind,
      source: "desk",
      payload,
      createdAt: args.now,
      expiresAt,
      status: "open",
    });
    return { ok: true as const, duplicate: false, orderId, status: "open" as const, expiresAt };
  }),
});

export const withdrawOrder = mutation({
  args: { ...authArgs, orderId: v.string() },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const order = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
      .unique();
    if (!order || order.carrierId !== carrier.carrierId) refuse("order_not_found");
    if (order.status !== "open" && order.status !== "accepted") {
      return { ok: true as const, status: order.status };
    }
    await ctx.db.patch(order._id, { status: "withdrawn", closedAt: args.now });
    return { ok: true as const, status: "withdrawn" as const };
  }),
});

// --- Replies (truck to desk) ---

export const REPLY_KINDS = [
  "accepted",
  "declined",
  "counter",
  "delivered",
  "trouble",
  "signed_on",
  "parked",
  // The driver heard a note; closes it and tells the desk nothing.
  "heard",
] as const;
type ReplyKind = (typeof REPLY_KINDS)[number];

const TROUBLE_KINDS = ["breakdown", "inspection", "citation", "out_of_hours"];

function cleanReply(kind: ReplyKind, raw: Record<string, unknown>) {
  switch (kind) {
    case "accepted":
    case "heard":
      return {};
    case "declined":
      return compact({ reason: screened(raw.reason, "reason", 160) });
    case "counter":
      return compact({
        // Game minutes of hours-of-service time the driver has left.
        hosMinutesLeft: num(raw.hosMinutesLeft, "hosMinutesLeft", 0, 14 * 60),
        // Where they can make it tonight, or when they need to be home.
        canReach: text(raw.canReach, "canReach", 80),
        homeBy: text(raw.homeBy, "homeBy", 60),
        text: screened(raw.text, "text", 160),
      });
    case "delivered":
      return compact({
        onTime: bool(raw.onTime, "onTime") ?? refuse("invalid_payload", "onTime"),
        // Game minutes.
        minutesLate: num(raw.minutesLate, "minutesLate", 0, 30 * 24 * 60),
        detentionMinutes: num(raw.detentionMinutes, "detentionMinutes", 0, 7 * 24 * 60),
        miles: num(raw.miles, "miles", 0, 10_000),
        pay: num(raw.pay, "pay", 0, 1_000_000),
        lateReason: text(raw.lateReason, "lateReason", 120),
      });
    case "trouble": {
      const what = text(raw.trouble, "trouble", 32, true);
      if (!TROUBLE_KINDS.includes(what)) refuse("invalid_payload", "trouble");
      return compact({ trouble: what, text: screened(raw.text, "text", 160) });
    }
    case "signed_on":
    case "parked":
      return {};
  }
}

// Which order kinds each answer applies to, and what it does to the order.
const ANSWERS: Partial<Record<ReplyKind, { kinds: OrderKind[]; from: string[]; to?: Doc<"freightFateDispatchOrders">["status"] }>> = {
  accepted: { kinds: ["load_offer", "route", "go_home"], from: ["open"], to: "accepted" },
  declined: { kinds: ["load_offer", "route", "go_home"], from: ["open"], to: "declined" },
  counter: { kinds: ["load_offer", "go_home"], from: ["open"] },
  delivered: { kinds: ["load_offer"], from: ["open", "accepted"], to: "done" },
  heard: { kinds: ["note"], from: ["open"], to: "done" },
};

export const postReply = mutation({
  args: {
    ...authArgs,
    replyId: v.string(),
    orderId: v.optional(v.string()),
    kind: v.string(),
    payload: v.optional(v.any()),
  },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, REPLY);
    if (!(REPLY_KINDS as readonly string[]).includes(args.kind)) refuse("invalid_payload", "kind");
    const kind = args.kind as ReplyKind;
    const replyId = text(args.replyId, "replyId", 96, true);
    const member = await activeMembership(ctx, driver.driverId);
    if (!member) refuse("not_a_member");

    const existing = await ctx.db
      .query("freightFateDispatchReplies")
      .withIndex("by_reply_id", (q) => q.eq("replyId", replyId))
      .unique();
    if (existing) {
      if (existing.driverId !== driver.driverId) refuse("reply_id_taken");
      return { ok: true as const, duplicate: true };
    }

    const raw = (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = cleanReply(kind, raw);

    const rule = ANSWERS[kind];
    let order: Doc<"freightFateDispatchOrders"> | null = null;
    if (rule) {
      if (!args.orderId) refuse("invalid_payload", "orderId");
      order = await ctx.db
        .query("freightFateDispatchOrders")
        .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId!))
        .unique();
      if (!order || order.driverId !== driver.driverId || order.carrierId !== member.carrierId) {
        refuse("order_not_found");
      }
      if (!rule.kinds.includes(order.kind)) refuse("wrong_order_kind");
      // Too late: the offer lapsed or the desk took it back. The game says
      // so rather than pretending the answer landed.
      if (!rule.from.includes(order.status)) {
        return { ok: false as const, reason: "order_closed", status: order.status };
      }
    } else if (args.orderId) {
      payload.orderId = args.orderId;
    }

    if (order && rule?.to) {
      const closing = rule.to !== "accepted";
      await ctx.db.patch(order._id, {
        status: rule.to,
        answeredAt: args.now,
        ...(closing ? { closedAt: args.now } : {}),
        // Accepting a load or a run home starts its delivery clock.
        ...(rule.to === "accepted" ? { expiresAt: args.now + ACCEPTED_LOAD_MS } : {}),
      });
    }

    // A delivered load closes the route orders that rode on it.
    if (kind === "delivered" && order) {
      for (const status of ["open", "accepted"] as const) {
        const routes = await ctx.db
          .query("freightFateDispatchOrders")
          .withIndex("by_driver_status", (q) => q.eq("driverId", driver.driverId).eq("status", status))
          .collect();
        for (const route of routes) {
          if (route.kind === "route" && (route.payload as { loadOrderId?: string }).loadOrderId === order.orderId) {
            await ctx.db.patch(route._id, { status: "done", closedAt: args.now });
          }
        }
      }
    }

    // Where the truck is, as the heartbeat last said, so the desk hears a
    // sign-on or a breakdown with its place attached.
    if (kind === "signed_on" || kind === "parked" || kind === "trouble") {
      if (member.truck) payload.truck = member.truck;
    }

    if (kind !== "heard") {
      await ctx.db.insert("freightFateDispatchReplies", {
        replyId,
        ...(args.orderId ? { orderId: args.orderId } : {}),
        carrierId: member.carrierId,
        driverId: driver.driverId,
        kind,
        source: "driver",
        payload,
        createdAt: args.now,
      });
    } else {
      // Still remembered, so a retried "heard" is a no-op; born read.
      await ctx.db.insert("freightFateDispatchReplies", {
        replyId,
        ...(args.orderId ? { orderId: args.orderId } : {}),
        carrierId: member.carrierId,
        driverId: driver.driverId,
        kind,
        source: "driver",
        payload,
        createdAt: args.now,
        readAt: args.now,
      });
    }
    return { ok: true as const, duplicate: false, ...(order ? { orderStatus: rule?.to ?? order.status } : {}) };
  }),
});

export const markRepliesRead = mutation({
  args: { ...authArgs, replyIds: v.array(v.string()) },
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInWriter(ctx, args, DESK);
    const carrier = await deskCarrier(ctx, driver.driverId);
    if (args.replyIds.length > MAX_REPLIES_PER_READ) refuse("invalid_payload", "replyIds");
    let marked = 0;
    for (const replyId of args.replyIds) {
      const reply = await ctx.db
        .query("freightFateDispatchReplies")
        .withIndex("by_reply_id", (q) => q.eq("replyId", replyId))
        .unique();
      if (reply && reply.carrierId === carrier.carrierId && reply.readAt === undefined) {
        await ctx.db.patch(reply._id, { readAt: args.now });
        marked += 1;
      }
    }
    return { ok: true as const, marked };
  }),
});

// --- Reads ---

function orderView(order: Doc<"freightFateDispatchOrders">) {
  return {
    orderId: order.orderId,
    driverId: order.driverId,
    kind: order.kind,
    source: order.source,
    payload: order.payload,
    status: order.status,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    ...(order.answeredAt !== undefined ? { answeredAt: order.answeredAt } : {}),
  };
}

function nightDispatcherOn(carrier: Doc<"freightFateCarriers">, member: Doc<"freightFateCarrierMembers">) {
  return member.nightDispatcher ?? carrier.nightDispatcherDefault;
}

async function onDuty(ctx: QueryCtx, driverId: string, now: number) {
  const beat = await ctx.db
    .query("freightFatePresenceBeats")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .unique();
  if (!beat) return { online: false as const, lastBeatAt: undefined };
  const row = await ctx.db
    .query("freightFatePresence")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .unique();
  const paused = row?.activity === PAUSED_ACTIVITY;
  const online = !!row && !paused && beat.updatedAt >= now - PRESENCE_TTL_MS;
  return { online, paused, lastBeatAt: beat.updatedAt };
}

async function driverOrders(ctx: QueryCtx, driverId: string, carrierId: string) {
  const out: Doc<"freightFateDispatchOrders">[] = [];
  for (const status of ["open", "accepted"] as const) {
    const rows = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_driver_status", (q) => q.eq("driverId", driverId).eq("status", status))
      .collect();
    out.push(...rows.filter((row) => row.carrierId === carrierId));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** The driver's side: their carrier, standing rules and orders.
 *
 * Also says whether this account runs a carrier, so Dispatch can open its
 * live desk with one call. A stint the desk ended (released, or the carrier
 * closed) is reported for a day so Freight Fate can tell the driver once.
 */
export const getMyDispatch = query({
  args: authArgs,
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInReader(ctx, args);
    const owned = await ownedCarrier(ctx, driver.driverId);
    const member = await activeMembership(ctx, driver.driverId);
    const carrier = member ? await carrierById(ctx, member.carrierId) : null;

    let ended: { carrierName: string; reason: string; at: number } | undefined;
    if (!member) {
      const last = await ctx.db
        .query("freightFateCarrierMembers")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId).gt("leftAt", args.now - DAY_MS))
        .order("desc")
        .first();
      if (last && last.leftAt !== undefined && last.leftReason !== "left") {
        const was = await carrierById(ctx, last.carrierId);
        if (was) ended = { carrierName: was.name, reason: last.leftReason ?? "released", at: last.leftAt };
      }
    }

    return {
      ok: true as const,
      ownsCarrierId: owned?.carrierId ?? null,
      carrier: member && carrier
        ? {
          carrierId: carrier.carrierId,
          name: carrier.name,
          homeTerminal: carrier.homeTerminal,
          ...(carrier.secondTerminal ? { secondTerminal: carrier.secondTerminal } : {}),
          joinedAt: member.joinedAt,
          standingRules: member.standingRules,
          nightDispatcher: nightDispatcherOn(carrier, member),
          notesMuted: member.notesMuted ?? false,
        }
        : null,
      orders: member ? (await driverOrders(ctx, driver.driverId, member.carrierId)).map(orderView) : [],
      ...(ended ? { ended } : {}),
    };
  }),
});

/** The dispatcher's live desk: carrier, roster, open orders, unheard replies.
 *
 * The roster shows only what the design allows a dispatcher to see: name,
 * position, hours, fuel and cargo, and whether the driver is on duty now.
 */
export const getCarrierDesk = query({
  args: authArgs,
  handler: (ctx, args) => answer(async () => {
    const driver = await signedInReader(ctx, args);
    const carrier = await deskCarrier(ctx, driver.driverId);
    const members = await ctx.db
      .query("freightFateCarrierMembers")
      .withIndex("by_carrier", (q) => q.eq("carrierId", carrier.carrierId).eq("leftAt", undefined))
      .collect();

    const roster = [];
    for (const member of members) {
      const row = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", member.driverId))
        .unique();
      const duty = await onDuty(ctx, member.driverId, args.now);
      roster.push({
        driverId: member.driverId,
        displayName: maskDisplayName(row?.displayName ?? "Driver", member.driverId, "Driver"),
        joinedAt: member.joinedAt,
        online: duty.online,
        ...(duty.paused ? { paused: true } : {}),
        ...(duty.lastBeatAt !== undefined ? { lastSeenAt: duty.lastBeatAt } : {}),
        ...(member.truck ? { truck: member.truck, truckChangedAt: member.truckChangedAt } : {}),
        standingRules: member.standingRules,
        nightDispatcher: nightDispatcherOn(carrier, member),
        notesMuted: member.notesMuted ?? false,
      });
    }

    const orders: Doc<"freightFateDispatchOrders">[] = [];
    for (const status of ["open", "accepted"] as const) {
      orders.push(...await ctx.db
        .query("freightFateDispatchOrders")
        .withIndex("by_carrier_status", (q) => q.eq("carrierId", carrier.carrierId).eq("status", status))
        .collect());
    }
    orders.sort((a, b) => a.createdAt - b.createdAt);

    const replies = await ctx.db
      .query("freightFateDispatchReplies")
      .withIndex("by_carrier_read", (q) => q.eq("carrierId", carrier.carrierId).eq("readAt", undefined))
      .take(MAX_REPLIES_PER_READ);

    return {
      ok: true as const,
      carrier: {
        carrierId: carrier.carrierId,
        name: carrier.name,
        homeTerminal: carrier.homeTerminal,
        ...(carrier.secondTerminal ? { secondTerminal: carrier.secondTerminal } : {}),
        inviteCode: carrier.inviteCode,
        nightDispatcherDefault: carrier.nightDispatcherDefault,
        lanes: carrier.lanes,
      },
      roster,
      orders: orders.map(orderView),
      replies: replies.map((reply) => ({
        replyId: reply.replyId,
        ...(reply.orderId ? { orderId: reply.orderId } : {}),
        driverId: reply.driverId,
        kind: reply.kind,
        source: reply.source,
        payload: reply.payload,
        createdAt: reply.createdAt,
      })),
    };
  }),
});

// --- The night desk and the clock ---

/** Where the night desk sends an empty truck sitting in `city`. */
export function nightDeskLane(carrier: Pick<Doc<"freightFateCarriers">, "lanes" | "homeTerminal" | "secondTerminal">, city: string, pick: number) {
  const fits = carrier.lanes.filter(
    (lane) => (lane.origin === undefined || sameCity(lane.origin, city)) && !sameCity(lane.destination, city),
  );
  // Lanes out of this very city before lanes from anywhere.
  const local = fits.filter((lane) => lane.origin !== undefined);
  const pool = local.length ? local : fits;
  if (pool.length) return pool[pick % pool.length];
  // Nothing on the books from here: bring the truck toward a terminal.
  for (const terminal of [carrier.homeTerminal, carrier.secondTerminal]) {
    if (terminal && !sameCity(terminal, city)) return { destination: terminal } as Lane;
  }
  return null;
}

async function candidateDrivers(ctx: QueryCtx, now: number) {
  const audience = liveDispatchAudience();
  if (audience === "all") {
    const beats = await ctx.db
      .query("freightFatePresenceBeats")
      .withIndex("by_updated", (q) => q.gte("updatedAt", now - PRESENCE_TTL_MS))
      .take(500);
    return beats.map((beat) => beat.driverId);
  }
  return audience;
}

/** Offer a load to every signed-on, empty carrier driver with nothing queued. */
async function runNightDesk(ctx: MutationCtx, now: number) {
  let offered = 0;
  for (const driverId of await candidateDrivers(ctx, now)) {
    const member = await activeMembership(ctx, driverId);
    if (!member?.truck || member.truck.loaded) continue;
    if (member.lastNightOfferAt !== undefined && now - member.lastNightOfferAt < NIGHT_DESK_COOLDOWN_MS) continue;
    const duty = await onDuty(ctx, driverId, now);
    if (!duty.online) continue;
    const carrier = await carrierById(ctx, member.carrierId);
    if (!carrier || carrier.closedAt !== undefined || !nightDispatcherOn(carrier, member)) continue;
    const queued = await driverOrders(ctx, driverId, carrier.carrierId);
    if (queued.some((order) => order.kind === "load_offer" || order.kind === "go_home")) continue;

    const seed = randomHex(8);
    const lane = nightDeskLane(carrier, member.truck.city, parseInt(seed.slice(0, 6), 16));
    // Remember the attempt either way, so a driver with nowhere to go is not
    // re-checked every tick.
    await ctx.db.patch(member._id, { lastNightOfferAt: now });
    if (!lane) continue;

    const orderId = `night_${seed}`;
    const expiresAt = now + NIGHT_DESK_PICKUP_MS;
    await ctx.db.insert("freightFateDispatchOrders", {
      orderId,
      carrierId: carrier.carrierId,
      driverId,
      kind: "load_offer",
      source: "night_desk",
      payload: compact({
        jobSeed: seed,
        origin: member.truck.city,
        destination: lane.destination,
        cargo: lane.cargo,
        pickupBy: expiresAt,
      }),
      createdAt: now,
      expiresAt,
      status: "open",
    });
    await tellDesk(ctx, {
      carrierId: carrier.carrierId,
      driverId,
      kind: "night_desk",
      orderId,
      payload: compact({ origin: member.truck.city, destination: lane.destination, cargo: lane.cargo }),
      now,
    });
    offered += 1;
  }
  return offered;
}

/** Lapse orders whose time ran out, and tell the desk. */
async function lapseExpired(ctx: MutationCtx, now: number) {
  let lapsed = 0;
  for (const status of ["open", "accepted"] as const) {
    const due = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_status_expires", (q) => q.eq("status", status).lt("expiresAt", now))
      .take(CRON_BATCH);
    for (const order of due) {
      await ctx.db.patch(order._id, { status: "lapsed", closedAt: now });
      // A note nobody heard needs no report; anything else the desk acted on.
      if (order.kind !== "note") {
        await tellDesk(ctx, {
          carrierId: order.carrierId,
          driverId: order.driverId,
          kind: "lapsed",
          orderId: order.orderId,
          payload: { orderKind: order.kind, wasAccepted: status === "accepted" },
          now,
        });
      }
      lapsed += 1;
    }
  }
  return lapsed;
}

/** Every five minutes: lapse what expired, then run the night desk.
 *
 * With the flag off this reads nothing at all. With it on, a tick with no
 * carrier drivers on duty reads one index range of fresh heartbeats.
 */
export const dispatchTick = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const audience = liveDispatchAudience();
    if (audience !== "all" && audience.length === 0) return { lapsed: 0, offered: 0 };
    const lapsed = await lapseExpired(ctx, now);
    const offered = await runNightDesk(ctx, now);
    return { lapsed, offered };
  },
});

/** Daily: drop orders closed and replies heard more than thirty days ago. */
export const pruneDispatchMail = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - DISPATCH_RETENTION_MS;
    const orders = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_closed", (q) => q.gt("closedAt", 0).lt("closedAt", cutoff))
      .take(CRON_BATCH);
    for (const row of orders) await ctx.db.delete(row._id);
    const replies = await ctx.db
      .query("freightFateDispatchReplies")
      .withIndex("by_read", (q) => q.gt("readAt", 0).lt("readAt", cutoff))
      .take(CRON_BATCH);
    for (const row of replies) await ctx.db.delete(row._id);
    return { orders: orders.length, replies: replies.length };
  },
});

/** Account deletion: everything live dispatch holds for this driver.
 *
 * A carrier they owned closes and its drivers are released, the same as a
 * dispatcher closing it by hand; their own memberships, orders and replies
 * go with them.
 */
export async function purgeDispatchForDriver(ctx: MutationCtx, driverId: string, now: number) {
  let removed = 0;
  const owned = await ctx.db
    .query("freightFateCarriers")
    .withIndex("by_owner", (q) => q.eq("ownerDriverId", driverId))
    .collect();
  for (const carrier of owned) {
    const members = await ctx.db
      .query("freightFateCarrierMembers")
      .withIndex("by_carrier", (q) => q.eq("carrierId", carrier.carrierId))
      .collect();
    for (const member of members) {
      if (member.leftAt === undefined) await endStint(ctx, member, "carrier_closed", now);
    }
    const orders = await ctx.db
      .query("freightFateDispatchOrders")
      .withIndex("by_carrier_status", (q) => q.eq("carrierId", carrier.carrierId))
      .collect();
    const replies = await ctx.db
      .query("freightFateDispatchReplies")
      .withIndex("by_carrier_read", (q) => q.eq("carrierId", carrier.carrierId))
      .collect();
    for (const row of [...orders, ...replies]) {
      await ctx.db.delete(row._id);
      removed += 1;
    }
    // The row stays, closed and anonymous, so a released driver can still be
    // told whose carrier ended; the owner's id goes with the account.
    await ctx.db.patch(carrier._id, { closedAt: carrier.closedAt ?? now, ownerDriverId: "deleted", updatedAt: now });
  }

  const memberships = await ctx.db
    .query("freightFateCarrierMembers")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId))
    .collect();
  for (const member of memberships) {
    await ctx.db.delete(member._id);
    removed += 1;
  }
  const orders = await ctx.db
    .query("freightFateDispatchOrders")
    .withIndex("by_driver_status", (q) => q.eq("driverId", driverId))
    .collect();
  for (const order of orders) {
    await ctx.db.delete(order._id);
    removed += 1;
  }
  const replies = await ctx.db
    .query("freightFateDispatchReplies")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId))
    .collect();
  for (const reply of replies) {
    await ctx.db.delete(reply._id);
    removed += 1;
  }
  return removed;
}
