/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { describe, expect, test } from "vitest";
import type { FreightFateDispatchCallFacts } from "./freightFateRequest";
import { SHARING_CONSENT_VERSION } from "./freightFate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const callsApi = anyApi.freightFateDispatchCalls;
const NOW = 1_800_000_000_000;
const VALID_FACTS: FreightFateDispatchCallFacts = {
  remainingMiles: 120,
  hoursLeft: 8,
  truckDamagePct: 4,
  cargoDamagePct: 2,
  hosRemainingMinutes: 360,
  weatherAlerts: 1,
};

function setup() {
  return convexTest(schema, modules);
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function driver(
  t: ReturnType<typeof setup>,
  driverId: string,
  options: {
    visibility?: "public" | "private" | "unlisted";
    sharingConsentVersion?: number;
    integrityFlag?: string;
  } = {},
) {
  const token = `token-for-${driverId}-must-be-long-enough`;
  const driverTokenHash = await sha256Hex(token);
  await t.run(async (ctx) => {
    await ctx.db.insert("freightFateDrivers", {
      driverId,
      displayName: `Name ${driverId}`,
      visibility: options.visibility ?? "public",
      driverTokenHash,
      sharingConsentVersion: options.sharingConsentVersion ?? SHARING_CONSENT_VERSION,
      ...(options.integrityFlag === undefined
        ? {}
        : { integrityFlag: options.integrityFlag }),
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  return { driverId, driverTokenHash };
}

function createArgs(
  caller: { driverId: string; driverTokenHash: string },
  overrides: Partial<{
    requestId: string;
    kind: string;
    facts: unknown;
    now: number;
    driverTokenHash: string;
  }> = {},
) {
  return {
    driverId: caller.driverId,
    driverTokenHash: overrides.driverTokenHash ?? caller.driverTokenHash,
    requestId: overrides.requestId ?? `request-${caller.driverId}`,
    kind: overrides.kind ?? "delay",
    facts: overrides.facts ?? VALID_FACTS,
    now: overrides.now ?? NOW,
  };
}

async function createCall(
  t: ReturnType<typeof setup>,
  caller: { driverId: string; driverTokenHash: string },
  overrides: Parameters<typeof createArgs>[1] = {},
) {
  return await t.mutation(callsApi.create, createArgs(caller, overrides));
}

async function callStatus(
  t: ReturnType<typeof setup>,
  caller: { driverId: string; driverTokenHash: string },
  callId: string,
  now = NOW,
) {
  return await t.mutation(callsApi.status, {
    driverId: caller.driverId,
    driverTokenHash: caller.driverTokenHash,
    callId,
    now,
  });
}

describe("remote dispatcher calls", () => {
  test("rejects an unauthorized token", async () => {
    const t = setup();
    const caller = await driver(t, "caller-auth");

    await expect(
      createCall(t, caller, { driverTokenHash: "0".repeat(64) }),
    ).resolves.toEqual({ ok: false, reason: "unauthorized" });
  });

  test.each([
    ["private", { visibility: "private" as const }],
    ["stale consent", { sharingConsentVersion: SHARING_CONSENT_VERSION - 1 }],
    ["integrity-flagged", { integrityFlag: "unsigned" }],
  ])("rejects an ineligible caller and responder (%s)", async (_label, options) => {
    const t = setup();
    const ineligible = await driver(t, `driver-${String(_label)}`, options);
    const eligibleCaller = await driver(t, "caller-eligible");

    await expect(createCall(t, ineligible)).resolves.toEqual({
      ok: false,
      reason: "not_listed",
    });

    const call = await createCall(t, eligibleCaller, {
      requestId: `request-${String(_label)}`,
    });
    if (!call.ok) throw new Error("call creation failed");
    const claim = await t.mutation(callsApi.claim, {
      driverId: ineligible.driverId,
      driverTokenHash: ineligible.driverTokenHash,
      callId: call.callId as string,
      now: NOW,
    });
    expect(claim).toEqual({ ok: false, reason: "not_listed" });

    const open = await t.mutation(callsApi.open, {
      driverId: ineligible.driverId,
      driverTokenHash: ineligible.driverTokenHash,
      now: NOW,
    });
    expect(open).toEqual({ ok: false, reason: "not_listed" });
    expect(call.ok).toBe(true);
  });

  test("rejects unsupported kinds", async () => {
    const t = setup();
    const caller = await driver(t, "caller-kind");

    await expect(createCall(t, caller, { kind: "weather" })).resolves.toEqual({
      ok: false,
      reason: "unsupported_kind",
    });
  });

  test("clamps facts and drops extra fields", async () => {
    const t = setup();
    const caller = await driver(t, "caller-facts");
    const created = await createCall(t, caller, {
      facts: {
        remainingMiles: -5,
        hoursLeft: 5000,
        truckDamagePct: 101,
        cargoDamagePct: 42.5,
        hosRemainingMinutes: -10,
        weatherAlerts: 25.8,
        summary: "do not store",
        message: "do not store",
        extra: "also dropped",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const row = await t.run(async (ctx) =>
      await ctx.db
        .query("freightFateDispatchCalls")
        .withIndex("by_call_id", (q) => q.eq("callId", created.callId as string))
        .unique(),
    );
    expect(row?.facts).toEqual({
      remainingMiles: 0,
      hoursLeft: 1000,
      truckDamagePct: 100,
      cargoDamagePct: 42.5,
      hosRemainingMinutes: 0,
      weatherAlerts: 20,
    });
    expect(row).not.toHaveProperty("summary");
    expect(row).not.toHaveProperty("message");
  });

  test("rejects non-finite facts", async () => {
    const t = setup();
    const caller = await driver(t, "caller-invalid-facts");

    await expect(
      createCall(t, caller, { facts: { ...VALID_FACTS, hoursLeft: Number.POSITIVE_INFINITY } }),
    ).resolves.toEqual({ ok: false, reason: "invalid_facts" });
  });

  test("create is idempotent by caller and request ID", async () => {
    const t = setup();
    const caller = await driver(t, "caller-idempotent");
    const first = await createCall(t, caller, { requestId: "same-request" });
    const second = await createCall(t, caller, {
      requestId: "same-request",
      now: NOW + 1,
      facts: { ...VALID_FACTS, remainingMiles: 999 },
    });

    expect(first).toEqual(second);
    expect(
      await t.run(async (ctx) =>
        await ctx.db
          .query("freightFateDispatchCalls")
          .withIndex("by_caller_request", (q) =>
            q.eq("callerDriverId", caller.driverId).eq("requestId", "same-request"),
          )
          .collect(),
      ),
    ).toHaveLength(1);
  });

  test("a new call cancels the caller's older open call", async () => {
    const t = setup();
    const caller = await driver(t, "caller-replace");
    const first = await createCall(t, caller, { requestId: "first" });
    const second = await createCall(t, caller, { requestId: "second", now: NOW + 1 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(await callStatus(t, caller, first.callId as string, NOW + 1)).toMatchObject({
      ok: true,
      status: "cancelled",
    });
    expect(await callStatus(t, caller, second.callId as string, NOW + 1)).toMatchObject({
      ok: true,
      status: "ringing",
    });
  });

  test("the first claim wins and a later claimer gets taken", async () => {
    const t = setup();
    const caller = await driver(t, "caller-claim");
    const firstResponder = await driver(t, "responder-first");
    const secondResponder = await driver(t, "responder-second");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");

    await expect(
      t.mutation(callsApi.claim, {
        driverId: firstResponder.driverId,
        driverTokenHash: firstResponder.driverTokenHash,
        callId: created.callId as string,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      t.mutation(callsApi.claim, {
        driverId: secondResponder.driverId,
        driverTokenHash: secondResponder.driverTokenHash,
        callId: created.callId as string,
        now: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "taken" });
  });

  test("a responder cannot claim their own call", async () => {
    const t = setup();
    const caller = await driver(t, "caller-self");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");

    await expect(
      t.mutation(callsApi.claim, {
        driverId: caller.driverId,
        driverTokenHash: caller.driverTokenHash,
        callId: created.callId as string,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "own_call" });
  });

  test("expires a ringing call at ringUntil", async () => {
    const t = setup();
    const caller = await driver(t, "caller-ring-expiry");
    const responder = await driver(t, "responder-ring-expiry");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");

    const result = await t.mutation(callsApi.claim, {
      driverId: responder.driverId,
      driverTokenHash: responder.driverTokenHash,
      callId: created.callId as string,
      now: created.ringUntil as number,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(await callStatus(t, caller, created.callId as string, created.ringUntil as number))
      .toMatchObject({ ok: true, status: "expired" });
  });

  test("expires a claimed call at answerBy", async () => {
    const t = setup();
    const caller = await driver(t, "caller-answer-expiry");
    const responder = await driver(t, "responder-answer-expiry");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");
    const claimedAt = NOW + 1;
    await t.mutation(callsApi.claim, {
      driverId: responder.driverId,
      driverTokenHash: responder.driverTokenHash,
      callId: created.callId as string,
      now: claimedAt,
    });

    const result = await t.mutation(callsApi.answer, {
      driverId: responder.driverId,
      driverTokenHash: responder.driverTokenHash,
      callId: created.callId as string,
      decision: "watch",
      now: claimedAt + 90_000,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test("rejects a decision outside the call kind's vocabulary", async () => {
    const t = setup();
    const caller = await driver(t, "caller-decision");
    const responder = await driver(t, "responder-decision");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");
    await t.mutation(callsApi.claim, {
      driverId: responder.driverId,
      driverTokenHash: responder.driverTokenHash,
      callId: created.callId as string,
      now: NOW,
    });

    await expect(
      t.mutation(callsApi.answer, {
        driverId: responder.driverId,
        driverTokenHash: responder.driverTokenHash,
        callId: created.callId as string,
        decision: "stop",
        now: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_decision" });
  });

  test("only the assigned responder can answer", async () => {
    const t = setup();
    const caller = await driver(t, "caller-non-claimer");
    const assigned = await driver(t, "responder-assigned");
    const other = await driver(t, "responder-unassigned");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");
    await t.mutation(callsApi.claim, {
      driverId: assigned.driverId,
      driverTokenHash: assigned.driverTokenHash,
      callId: created.callId as string,
      now: NOW,
    });

    await expect(
      t.mutation(callsApi.answer, {
        driverId: other.driverId,
        driverTokenHash: other.driverTokenHash,
        callId: created.callId as string,
        decision: "watch",
        now: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_responder" });
  });

  test("only the caller can see status or cancel a call", async () => {
    const t = setup();
    const caller = await driver(t, "caller-private-status");
    const other = await driver(t, "other-private-status");
    const created = await createCall(t, caller);
    if (!created.ok) throw new Error("call creation failed");

    await expect(callStatus(t, other, created.callId as string)).resolves.toEqual({
      ok: false,
      reason: "call_not_found",
    });
    await expect(
      t.mutation(callsApi.cancel, {
        driverId: other.driverId,
        driverTokenHash: other.driverTokenHash,
        callId: created.callId as string,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "call_not_found" });
    expect(await callStatus(t, caller, created.callId as string)).toMatchObject({
      ok: true,
      status: "ringing",
    });
  });

  test("a responder can hold only one active claim", async () => {
    const t = setup();
    const responder = await driver(t, "responder-busy");
    const callerOne = await driver(t, "caller-busy-one");
    const callerTwo = await driver(t, "caller-busy-two");
    const first = await createCall(t, callerOne);
    const second = await createCall(t, callerTwo);
    if (!first.ok || !second.ok) throw new Error("call creation failed");

    await t.mutation(callsApi.claim, {
      driverId: responder.driverId,
      driverTokenHash: responder.driverTokenHash,
      callId: first.callId as string,
      now: NOW,
    });
    await expect(
      t.mutation(callsApi.claim, {
        driverId: responder.driverId,
        driverTokenHash: responder.driverTokenHash,
        callId: second.callId as string,
        now: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "busy" });
  });

  test("hits the per-endpoint write rate limit", async () => {
    const t = setup();
    const caller = await driver(t, "caller-rate-limit");
    let last;
    for (let index = 0; index < 10; index += 1) {
      last = await createCall(t, caller, {
        requestId: `request-${index}`,
        now: NOW,
      });
    }
    expect(last?.ok).toBe(true);
    await expect(
      createCall(t, caller, { requestId: "request-over-limit", now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });
});
