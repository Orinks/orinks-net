/// <reference types="vite/client" />
import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import invariants from "../data/freight-fate-profile-invariants.json";
import { REJECTED_UPLOAD_TTL_MS } from "./freightFateSaves";
import { levelForXp } from "./freightFateProfileProjection";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

function validProfile() {
  return {
    version: invariants.sourceSaveVersion, name: "Road Star", money: 9_000,
    current_city: "chicago_il_us",
    // Condition is per owned truck now; the flat fields are gone.
    truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4 } },
    calendar_offset_days: 0, migration_notice_pending: false,
    integrity_modified: false, integrity_notice_pending: false,
    game_hours: 240, tutorial_done: true, truck: "rig", owned_trucks: ["rig"],
    upgrades: {}, active_trip: null, dispatch_board_cache: null, fatigue: 10,
    pay_advance: 0, pay_advance_used_for_load: false,
    career: { xp: 4_800, reputation: 70, deliveries: 12, on_time_deliveries: 11,
      total_miles: 4_100, total_earnings: 21_500 },
    market: { seed: 1234, day: 10,
      multipliers: Object.fromEntries(invariants.marketCargoKeys.map((key) => [key, 1])) },
    hos: { driving_min: 0, duty_min: 0, since_break_min: 0, status: "off_duty",
      non_driving_min: 600, off_duty_min: 600, warned: [], history: [],
      split_rest_history: [], split_credit_key: null },
    achievements: [], achievement_stats: {},
  };
}

function meaningful(operationId: string, occurredAt: number, reason = "delivery_completed") {
  return { operationId, occurredAt, reason };
}

function contentFor(payload: unknown) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hash(content: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

function profileNamed(name: string) {
  return { ...validProfile(), name };
}

async function listedSaveNames(
  t: ReturnType<typeof setup>,
  auth: { driverId: string; driverTokenHash: string },
) {
  const listed = await t.query(api.freightFateSaves.listSaves, auth);
  if (!listed.ok) throw new Error(listed.reason ?? "save listing failed");
  return [...new Set(listed.saves.map((save) => save.saveName))].sort();
}

// provisionDriver mints nothing: a computer gets a token only by activating
// itself from the game, so both helpers below go through that path. The
// device-code hash is computed with node:crypto here and with Web Crypto
// inside Convex -- if those two ever disagreed, every one of these would fail.
async function connectComputer(
  t: ReturnType<typeof setup>,
  subject: string,
  label: string,
  now = Date.now(),
) {
  const started = await t.mutation(api.freightFateActivation.startActivation, {
    clientKey: `${subject}:${label}`, now,
  });
  await t.withIdentity({ subject }).mutation(api.freightFateActivation.claimActivation, {
    userCode: started.userCode, label, now,
  });
  const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
    deviceCodeHash: createHash("sha256").update(started.deviceCode, "utf8").digest("hex"), now,
  });
  return redeemed!.token;
}

async function provisionedDriver(t: ReturnType<typeof setup>, subject = "user_cloud") {
  const result = await t.withIdentity({ subject }).mutation(api.freightFate.provisionDriver, {
    displayName: `Cloud Hauler ${subject}`, visibility: "private", now: Date.now(),
  });
  const token = await connectComputer(t, subject, "My computer");
  return {
    driverId: result.driverId,
    driverTokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

async function upload(
  t: ReturnType<typeof setup>,
  auth: { driverId: string; driverTokenHash: string },
  payload = validProfile(),
  parentRevision: number | null = null,
  meaningfulPlay?: unknown,
  now = Date.now(),
) {
  const content = contentFor(payload);
  const request = {
    ...auth, saveName: payload.name, saveVersion: payload.version, parentRevision,
    contentHash: hash(content), content, summary: "Road Star, level 4", now,
    ...(meaningfulPlay === undefined ? {} : { meaningfulPlay }),
  };
  return t.action(anyApi.freightFateSaveActions.uploadValidatedSave, request);
}

async function uploadMeaningfully(
  t: ReturnType<typeof setup>,
  auth: { driverId: string; driverTokenHash: string },
  payload = validProfile(),
  parentRevision: number | null = null,
  operationId = "test-profile-selection",
) {
  const now = Date.now();
  await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now });
  return upload(t, auth, payload, parentRevision, meaningful(operationId, now), now);
}

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY = privateKey
    .export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID = "2026-07-test";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY;
  delete process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID;
});

describe("validated private cloud revisions", () => {
  test("rejects invalid content without creating a revision", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const invalid = { ...validProfile(), money: 1_000_000 };
    await expect(upload(t, auth, invalid)).resolves.toMatchObject({
      ok: false, reason: "impossible_money",
    });
    const listed = await t.query(api.freightFateSaves.listSaves, auth);
    expect(listed).toMatchObject({ ok: true, saves: [] });
  });

  test("a self-contradicting upload is kept as evidence, never auto-flagged", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const flagOf = async () => {
      const report = await t.query(internal.freightFateAdmin.listClientVersions, {});
      return report.find((row) => row.driverId === auth.driverId)?.integrityFlag ?? null;
    };
    const evidence = async () =>
      await t.query(internal.freightFateAdmin.listRejectedUploads, {});

    // A malformed upload is damage or version drift. Not evidence, not kept.
    const unknownField = Object.assign(validProfile(), { cheat_menu: true });
    await expect(upload(t, auth, unknownField))
      .resolves.toMatchObject({ ok: false, reason: "invalid_schema" });
    expect(await flagOf()).toBeNull();
    expect(await evidence()).toHaveLength(0);

    // Money the career never earned is rejected and retained -- but the
    // account is NOT branded. Screening rejects; humans convict.
    await expect(upload(t, auth, { ...validProfile(), money: 1_000_000 }))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });
    expect(await flagOf()).toBeNull();
    expect(await evidence()).toMatchObject([{ reason: "impossible_money" }]);

    // A second, different rejection is kept alongside the first.
    const inflatedXp = validProfile();
    inflatedXp.career.total_miles = 100;
    await expect(upload(t, auth, inflatedXp))
      .resolves.toMatchObject({ ok: false, reason: "impossible_xp" });
    expect(await flagOf()).toBeNull();
    expect(await evidence()).toHaveLength(2);

    // Retrying the same rejected payload does not grow the table.
    await expect(upload(t, auth, inflatedXp))
      .resolves.toMatchObject({ ok: false, reason: "impossible_xp" });
    expect(await evidence()).toHaveLength(2);

    // Honest cloud backups keep working throughout.
    await expect(upload(t, auth)).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await flagOf()).toBeNull();

    // A flag is still available, by hand, after reviewing the evidence.
    await t.mutation(internal.freightFateAdmin.setIntegrityFlag, {
      driverId: auth.driverId, flag: "impossible_money",
    });
    expect(await flagOf()).toBe("impossible_money");
  });

  test("the same rejected payload from two drivers is kept once per driver", async () => {
    const t = setup();
    const one = await provisionedDriver(t, "user_cloud_one");
    const two = await provisionedDriver(t, "user_cloud_two");
    // Deduping looks the payload up by driver AND hash. Keyed on the hash
    // alone, the second driver's evidence would be swallowed by the first
    // driver's row -- and a shared save doing the rounds would go unrecorded
    // for everyone but whoever uploaded it first.
    const shared = { ...validProfile(), money: 1_000_000 };
    await expect(upload(t, one, shared))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });
    await expect(upload(t, two, shared))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });

    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {}))
      .toHaveLength(2);
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {
      driverId: one.driverId,
    })).toHaveLength(1);
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {
      driverId: two.driverId,
    })).toHaveLength(1);
  });

  test("gear a career was granted rather than bought is not invented money", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    // Pricing owned gear as if it had been bought meant an owner-operator who
    // took title to a carrier tractor read as ~$150k of money the career never
    // earned, and their backup was rejected from then on.
    const bought = validProfile();
    bought.owned_trucks = ["rig", "heavy_hauler"];
    bought.upgrades = { engine_tune: 2, aero_kit: 1 };
    await expect(upload(t, auth, bought)).resolves.toMatchObject({ ok: true });
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {}))
      .toHaveLength(0);
  });

  test("retained evidence is pruned once its review window has passed", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await expect(upload(t, auth, { ...validProfile(), money: 1_000_000 }))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {}))
      .toHaveLength(1);

    // Still inside the window: evidence a moderator might still want stays.
    await t.mutation(internal.freightFateSaves.pruneRejectedUploads, {
      now: Date.now() + REJECTED_UPLOAD_TTL_MS - 60_000,
    });
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {}))
      .toHaveLength(1);

    // Past it, the payload goes: these rows carry a whole career each, so a
    // rejected save is not archived forever.
    await t.mutation(internal.freightFateSaves.pruneRejectedUploads, {
      now: Date.now() + REJECTED_UPLOAD_TTL_MS + 60_000,
    });
    expect(await t.query(internal.freightFateAdmin.listRejectedUploads, {}))
      .toHaveLength(0);
  });

  test("the XP ceiling tracks the game's own rate, not a copied number", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    // A career that delivered every mile on time earns exactly the exported
    // rate, so it lands ON the ceiling rather than under it. This passes on
    // today's rates too -- it is here to fail the day the game's XP model
    // outgrows the server's, which is how the hand-copied 1.2 came to sit
    // below what the 1.9 arc pays and started convicting honest drivers.
    const spotless = validProfile();
    spotless.career.total_miles = 5_000;
    spotless.career.deliveries = 20;
    spotless.career.on_time_deliveries = 20;
    spotless.career.xp = 20 * invariants.xpFlatPerDelivery
      + 5_000 * invariants.xpPerMileMax;
    await expect(upload(t, auth, spotless)).resolves.toMatchObject({ ok: true });
  });

  test("rejects a compressed payload that expands beyond the validation limit", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const content = contentFor({ pad: "x".repeat(300_000) });
    await expect(t.action(anyApi.freightFateSaveActions.uploadValidatedSave, {
      ...auth, saveName: "Road Star", saveVersion: 4, parentRevision: null,
      contentHash: hash(content), content, summary: "oversized", now: Date.now(),
    })).resolves.toMatchObject({ ok: false, reason: "invalid_schema" });
    const listed = await t.query(api.freightFateSaves.listSaves, auth);
    expect(listed).toMatchObject({ ok: true, saves: [] });
  });

  test("stores signature metadata and a server-derived public projection", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await expect(uploadMeaningfully(t, auth, validProfile(), null, "projection-signature"))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    const row = await t.run((ctx) => ctx.db.query("freightFateSaves").first());
    expect(row).toMatchObject({ keyId: "2026-07-test", validatorVersion: 1 });
    expect(row?.sig).toEqual(expect.any(String));
    const snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      level: 4,
      lastSavedCity: "Chicago, Illinois",
      truckName: "standard rig",
      deliveries: 12,
      sourceSaveName: "Road Star",
      sourceRevision: 1,
      validatorVersion: 1,
      // Pre-1.9 payloads carry no business status: the projection keeps
      // saying what it always said for them, and no fleet tier applies.
      employmentStatus: "Owner-operator",
      lifetimeEarnings: 21_500,
      badgesEarned: 0,
      // Level 4 has earned every sponsored endorsement, in unlock order.
      endorsements: ["flatbed securement", "refrigerated", "heavy-haul", "high-value"],
    });
    expect(snapshot?.fleetTier).toBeUndefined();
  });

  test("projects the 1.9 career fields onto the public snapshot", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const base = validProfile();
    // A level-2 company driver (xp 1,200) who paid for the high-value course
    // ahead of its sponsored level: earned flatbed and refrigerated, bought high-value,
    // and heavy-haul is still ahead of them. Their tier is the level band's.
    const payload = Object.assign(base, {
      business_status: "company_driver",
      career: Object.assign(base.career, { xp: 1_200, purchased_endorsements: ["high_value"] }),
      achievements: invariants.achievementIds.slice(0, 2),
    });
    await expect(uploadMeaningfully(t, auth, payload, null, "projection-1-9"))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    const snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      level: 2,
      employmentStatus: "Company driver",
      fleetTier: "yard standard",
      // Lifetime career earnings is the validated running total; the current
      // money balance is deliberately never stored on this row at all.
      lifetimeEarnings: 21_500,
      badgesEarned: 2,
      endorsements: ["flatbed securement", "refrigerated", "high-value"],
    });
    expect(snapshot).not.toHaveProperty("money");
    expect(Object.values(snapshot!)).not.toContain(payload.money);
  });

  test.each([
    ["first career first", ["First", "Second"]],
    ["second career first", ["Second", "First"]],
  ])("unions verified career achievements in either upload order without events: %s", async (_label, order) => {
    const t = setup();
    const auth = await provisionedDriver(t, `union_${order[0].toLowerCase()}`);
    const profiles = {
      First: Object.assign(validProfile(), {
        name: "First",
        achievements: ["first_delivery"],
      }),
      Second: Object.assign(validProfile(), {
        name: "Second",
        achievements: ["first_delivery", "clean_delivery"],
      }),
    };

    for (const name of order) {
      await expect(upload(t, auth, profiles[name as keyof typeof profiles]))
        .resolves.toMatchObject({ ok: true, revision: 1 });
    }

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("freightFateAchievements").collect();
      expect(rows.map((row) => row.achievementKey).sort())
        .toEqual(["clean_delivery", "first_delivery"]);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ importSource: "verified_save", importedAt: expect.any(Number) }),
      ]));
      expect(rows.every((row) => row.earnedAt === undefined)).toBe(true);
      expect(await ctx.db.query("freightFateDriverEvents").collect()).toEqual([]);
    });

    for (const saveName of order) {
      await expect(t.mutation(api.freightFateSaves.deleteSaveSlot, {
        ...auth, saveName,
      })).resolves.toMatchObject({ ok: true });
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateAchievements").collect()).toHaveLength(2);
    });
  });

  test("keeps event achievements idempotent after a verified import", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_import_then_event");
    const now = 1_800_000_000_000;
    const imported = Object.assign(validProfile(), { achievements: ["first_delivery"] });
    await expect(upload(t, auth, imported, null, undefined, now))
      .resolves.toMatchObject({ ok: true });
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now: now + 1 });

    await expect(t.mutation(api.freightFate.publishAchievementEarned, {
      ...auth,
      eventId: "achievement-first-delivery",
      achievementKey: "first_delivery",
      name: "First Delivery",
      description: "Completed a first delivery.",
      earnedAt: now,
      now: now + 2,
    })).resolves.toMatchObject({ ok: true, duplicate: true });

    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateAchievements").collect()).toHaveLength(1);
      expect(await ctx.db.query("freightFateDriverEvents").collect()).toEqual([]);
    });
  });

  test("switches only for a new accepted meaningful operation while sharing is on", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_meaningful_switch");
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"], now });
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now });

    const main = Object.assign(validProfile(), { name: "Main" });
    await expect(upload(t, auth, main, null, meaningful("op-main", now), now))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    const selected = async () => t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      const snapshot = await ctx.db.query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId)).unique();
      return { publicSaveName: driver?.publicSaveName, snapshot };
    });
    expect(await selected()).toMatchObject({
      publicSaveName: "Main",
      snapshot: { sourceSaveName: "Main", meaningfulPlayedAt: now },
    });

    const experiment = Object.assign(validProfile(), { name: "Experiment" });
    await expect(upload(t, auth, experiment, null, null, now + 1))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    const legacyBrowse = Object.assign(validProfile(), { name: "Legacy Browse" });
    await expect(upload(t, auth, legacyBrowse, null, undefined, now + 2))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    const legacyMain = structuredClone(main);
    legacyMain.career.reputation = 71;
    await expect(upload(t, auth, legacyMain, 1, undefined, now + 2))
      .resolves.toMatchObject({ ok: true, revision: 2 });
    expect(await selected()).toMatchObject({
      publicSaveName: "Main",
      snapshot: {
        sourceSaveName: "Main",
        sourceRevision: 1,
        reputation: 70,
        meaningfulPlayedAt: now,
        capturedAt: now,
      },
    });

    await expect(upload(t, auth, experiment, 1, meaningful("op-main", now), now + 3))
      .resolves.toMatchObject({ ok: true, revision: 2 });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    const rejected = Object.assign(validProfile(), { name: "Rejected", money: 1_000_000 });
    await expect(upload(t, auth, rejected, null, meaningful("op-rejected", now + 4), now + 4))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: false, now: now + 5 });
    const privateCareer = Object.assign(validProfile(), { name: "Private Career" });
    await expect(upload(t, auth, privateCareer, null, meaningful("op-private", now + 6), now + 6))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now: now + 7 });
    await expect(upload(t, auth, privateCareer, 1, meaningful("op-private", now + 6), now + 8))
      .resolves.toMatchObject({ ok: true, revision: 2 });
    expect(await selected()).toMatchObject({ publicSaveName: "Main", snapshot: { sourceSaveName: "Main" } });

    vi.setSystemTime(now + 9);
    await expect(upload(t, auth, experiment, 2, meaningful("op-experiment", now + 9), now + 9))
      .resolves.toMatchObject({ ok: true, revision: 3 });
    expect(await selected()).toMatchObject({
      publicSaveName: "Experiment",
      snapshot: { sourceSaveName: "Experiment", sourceRevision: 3, meaningfulPlayedAt: now + 9 },
    });
  });

  test("malformed, conflict, unauthorized, and rate-limited intents cannot switch", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_rejected_intents");
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"], now });
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now });
    const main = Object.assign(validProfile(), { name: "Main" });
    await upload(t, auth, main, null, meaningful("op-main", now), now);
    const candidate = Object.assign(validProfile(), { name: "Candidate" });

    await expect(upload(t, auth, candidate, null, meaningful("bad-reason", now + 1, "loaded"), now + 1))
      .resolves.toMatchObject({ ok: false, reason: "invalid_meaningful_play" });
    for (const invalidIntent of [
      meaningful("op-too-old", now - 90 * 24 * 60 * 60 * 1000 - 1),
      meaningful("op-too-new", now + 5 * 60 * 1000 + 1),
      { operationId: "op-fractional", occurredAt: now + 0.5, reason: "drive_started" },
    ]) {
      await expect(upload(t, auth, candidate, null, invalidIntent, now))
        .resolves.toMatchObject({ ok: false, reason: "invalid_meaningful_play" });
    }
    await expect(upload(t, auth, candidate, 99, meaningful("op-conflict", now + 2), now + 2))
      .resolves.toMatchObject({ ok: false, reason: "conflict" });
    await expect(upload(
      t,
      { ...auth, driverTokenHash: "wrong" },
      candidate,
      null,
      meaningful("op-unauthorized", now + 3),
      now + 3,
    )).resolves.toMatchObject({ ok: false, reason: "unauthorized" });
    await t.run(async (ctx) => {
      const counter = await ctx.db.query("freightFateRateLimits")
        .withIndex("by_key", (q) => q.eq("key", `save-upload:${auth.driverId}`)).unique();
      expect(counter).not.toBeNull();
      await ctx.db.patch(counter!._id, {
        count: 30,
        windowStart: now - (now % 60_000),
        updatedAt: now,
      });
    });
    await expect(upload(t, auth, candidate, null, meaningful("op-rate", now + 4), now + 4))
      .resolves.toMatchObject({ ok: false, reason: "rate_limited" });

    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      const operations = await ctx.db.query("freightFateMeaningfulPlayOperations").collect();
      expect(driver?.publicSaveName).toBe("Main");
      expect(operations.map((row) => row.operationId)).toEqual(["op-main"]);
    });
  });

  test("uses the server clock for meaningful-play acceptance and timestamps", async () => {
    const t = setup();
    const serverNow = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"], now: serverNow });
    const auth = await provisionedDriver(t, "user_server_clock");
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: serverNow,
    });

    const callerNow = serverNow + 365 * 24 * 60 * 60_000;
    await expect(upload(
      t,
      auth,
      Object.assign(validProfile(), { name: "Clock Career" }),
      null,
      meaningful("op-server-clock", serverNow),
      callerNow,
    )).resolves.toMatchObject({ ok: true, revision: 1 });

    await t.run(async (ctx) => {
      const save = await ctx.db.query("freightFateSaves").first();
      const operation = await ctx.db.query("freightFateMeaningfulPlayOperations").first();
      const snapshot = await ctx.db.query("freightFateProfileSnapshots").first();
      expect(save).toMatchObject({
        createdAt: serverNow,
        signedAt: new Date(serverNow).toISOString(),
      });
      expect(operation).toMatchObject({ acceptedAt: serverNow });
      expect(snapshot).toMatchObject({ capturedAt: serverNow, meaningfulPlayedAt: serverNow });
    });
  });

  test("does not select a career for a stale private sharing row", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"], now });
    const auth = await provisionedDriver(t, "user_stale_private");
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now });
    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      await ctx.db.patch(driver!._id, { visibility: "private" });
    });

    await expect(upload(
      t,
      auth,
      Object.assign(validProfile(), { name: "Private Career" }),
      null,
      meaningful("op-stale-private", now),
      now,
    )).resolves.toMatchObject({ ok: true, revision: 1 });
    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      expect(driver?.publicSaveName).toBeUndefined();
      expect(await ctx.db.query("freightFateProfileSnapshots").first()).toBeNull();
    });
  });

  test("selects a meaningful career for a consented unlisted profile", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"], now });
    const auth = await provisionedDriver(t, "user_unlisted_selection");
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now });
    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      await ctx.db.patch(driver!._id, { visibility: "unlisted" });
    });

    await expect(upload(
      t,
      auth,
      Object.assign(validProfile(), { name: "Link Career" }),
      null,
      meaningful("op-unlisted", now),
      now,
    )).resolves.toMatchObject({ ok: true, revision: 1 });
    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      expect(driver).toMatchObject({
        visibility: "unlisted",
        publicSaveName: "Link Career",
      });
      expect(await ctx.db.query("freightFateProfileSnapshots").first())
        .toMatchObject({ sourceSaveName: "Link Career", meaningfulPlayedAt: now });
    });
  });

  test("projects verified company-driver resume facts without valuing the assigned tractor", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_company_resume");
    const payload = Object.assign(validProfile(), {
      name: "Company Road",
      business_status: "company_driver",
      carrier_key: "northstar",
      carrier_name: "Client supplied carrier prose",
      truck: "ridgeline_sleeper",
      owned_trucks: [],
      owned_trailers: [],
      achievement_stats: {
        damage_free_deliveries: 9,
        longest_haul_miles: 875.4,
        cities_delivered: ["chicago_il_us", "denver_co_us", "milwaukee_wi_us"],
        states_delivered: ["not trusted"],
        cargo_claims: 1,
        preventable_equipment_damage: 2,
      },
      driving_record: {
        serious_violations: [100, 200], major_offenses: [220], citations: 3,
        fines_paid: 2_500, fatigue_events: 1, repossessions: 0, carrier_terminations: 1,
      },
    });
    payload.career.xp = 1_200;

    await expect(uploadMeaningfully(t, auth, payload, null, "company-projection"))
      .resolves.toMatchObject({ ok: true });
    const snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      saveName: "Company Road",
      businessStatus: "company_driver",
      employmentStatus: "Company driver",
      businessIdentity: "Company driver for Northstar Freight Lines",
      carrierName: "Northstar Freight Lines",
      level: 2,
      careerTitle: "New Hire Company Driver",
      truckName: "ridgeline sleeper",
      truckIsCarrierAssigned: true,
      deliveries: 12,
      onTimeDeliveries: 11,
      onTimeRate: 91.7,
      damageFreeDeliveries: 9,
      damageFreeRate: 75,
      citiesVisited: 3,
      statesVisited: 3,
      longestHaulMiles: 875.4,
      lifetimeEarnings: 21_500,
      netWorth: 9_000,
      netWorthComplete: true,
      safetyRecord: {
        citations: 3,
        seriousViolations: 2,
        majorOffenses: 1,
        fatigueEvents: 1,
        cargoClaims: 1,
        preventableEquipmentDamage: 2,
        carrierTerminations: 1,
        repossessions: 0,
      },
    });
    expect(snapshot).not.toHaveProperty("money");
    expect(snapshot?.netWorth).not.toBe(payload.money + invariants.truckPrices.ridgeline_sleeper);
  });

  test("projects complete owner-operator truck, upgrade, and trailer value", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_owner_resume");
    const payload = Object.assign(validProfile(), {
      name: "Owner Road",
      money: 90_000,
      business_status: "leased_owner_operator",
      carrier_key: "roadstead_owner_operator",
      carrier_name: "Client supplied carrier prose",
      truck: "ridgeline_sleeper",
      owned_trucks: ["ridgeline_sleeper"],
      owned_trailers: [],
      upgrades: { engine_tune: 2 },
      achievement_stats: {
        damage_free_deliveries: 88,
        longest_haul_miles: 1_400,
        cities_delivered: ["chicago_il_us", "denver_co_us"],
      },
      driving_record: {
        serious_violations: [], major_offenses: [], citations: 0,
        fines_paid: 0, fatigue_events: 0, repossessions: 1, carrier_terminations: 0,
      },
    });
    Object.assign(payload.career, {
      xp: 152_000,
      deliveries: 100,
      on_time_deliveries: 93,
      total_miles: 80_000,
      total_earnings: 750_000,
    });

    await expect(uploadMeaningfully(t, auth, payload, null, "owner-projection"))
      .resolves.toMatchObject({ ok: true });
    let snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      employmentStatus: "Leased-on owner-operator",
      businessIdentity: "Leased-on owner-operator with Northstar Freight Lines",
      careerTitle: "Leased-On Owner-Operator",
      truckIsCarrierAssigned: false,
      netWorth: 186_000,
      netWorthComplete: true,
    });

    const withTrailer = { ...structuredClone(payload), owned_trailers: ["dry_van"] };
    await expect(uploadMeaningfully(t, auth, withTrailer, 1, "owner-trailer"))
      .resolves.toMatchObject({ ok: true, revision: 2 });
    snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      netWorth: 228_000,
      netWorthComplete: true,
      sourceRevision: 2,
    });
  });

  test("keeps omitted meaningful intent upload-compatible without publishing", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_legacy_profile");
    const payload = validProfile();
    payload.achievement_stats = { damage_free_deliveries: 0, longest_haul_miles: 0 };
    await expect(upload(t, auth, payload)).resolves.toMatchObject({ ok: true, revision: 1 });

    await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      expect(driver?.publicSaveName).toBeUndefined();
      expect(await ctx.db.query("freightFateProfileSnapshots").first()).toBeNull();
    });

    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: Date.now(),
    });
    await expect(upload(
      t,
      auth,
      payload,
      1,
      meaningful("op-legacy-projection", Date.now()),
    )).resolves.toMatchObject({ ok: true, revision: 2 });
    await t.run(async (ctx) => {
      const snapshot = await ctx.db.query("freightFateProfileSnapshots").first();
      expect(snapshot).toMatchObject({
        sourceSaveName: "Road Star",
        careerTitle: "Level 4 driver",
        employmentStatus: "Owner-operator",
        damageFreeDeliveries: 0,
        damageFreeRate: 0,
      });
      expect(snapshot?.meaningfulPlayedAt).toEqual(expect.any(Number));
      expect(snapshot?.onTimeRate).toBe(91.7);
      expect(snapshot?.netWorth).toBeUndefined();
    });
  });

  test("clamps extreme XP to the exported level ladder maximum", () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(invariants.levelXp.length);
  });

  test("the saves list exposes each backup's save version", async () => {
    // The 1.9 game labels pre-1.9 backups in its restore menu straight from
    // this metadata (its cutover gate refuses to restore them), so the list
    // must keep saying which format each revision holds without the client
    // downloading anything.
    const t = setup();
    const auth = await provisionedDriver(t);
    await expect(upload(t, auth)).resolves.toMatchObject({ ok: true, revision: 1 });
    const listed = await t.query(api.freightFateSaves.listSaves, auth);
    expect(listed).toMatchObject({
      ok: true,
      saves: [{ saveName: "Road Star", revision: 1, saveVersion: validProfile().version }],
    });
  });

  test("preserves revision conflicts", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await upload(t, auth);
    await expect(upload(t, auth, validProfile(), null)).resolves.toMatchObject({
      ok: false, reason: "conflict", latestRevision: 1,
    });
    await expect(upload(t, auth, validProfile(), 1)).resolves.toMatchObject({
      ok: true, revision: 2,
    });
  });

  test("an eleventh career evicts the least recently meaningfully played slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    for (let slot = 1; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await expect(upload(
        t,
        auth,
        { ...validProfile(), name: `Career ${slot}` },
        null,
        meaningful(`career-${slot}`, Date.now()),
      ))
        .resolves.toMatchObject({ ok: true, revision: 1 });
    }

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(t, auth, { ...validProfile(), name: "Career 11" }))
      .resolves.toMatchObject({ ok: true, revision: 1, evictedSaveName: "Career 1" });

    const names = await listedSaveNames(t, auth);
    expect(names).toHaveLength(10);
    expect(names).not.toContain("Career 1");
    expect(names).toContain("Career 11");
  });

  test("never evicts the selected public career", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: Date.now(),
    });
    await upload(t, auth, profileNamed("Career 1"), null, meaningful("public-1", Date.now()));
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: false, now: Date.now() + 1,
    });
    for (let slot = 2; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await upload(t, auth, profileNamed(`Career ${slot}`), null, meaningful(`public-${slot}`, Date.now()));
    }
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: Date.now() + 1,
    });

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(t, auth, profileNamed("Career 11")))
      .resolves.toMatchObject({ ok: true, evictedSaveName: "Career 2" });
    expect(await listedSaveNames(t, auth)).toContain("Career 1");
  });

  test("uses the latest revision time for a legacy slot with no meaningful play", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    await upload(t, auth, profileNamed("Legacy"));
    for (let slot = 2; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await upload(t, auth, profileNamed(`Played ${slot}`), null, meaningful(`played-${slot}`, Date.now()));
    }

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(t, auth, profileNamed("Incoming")))
      .resolves.toMatchObject({ ok: true, evictedSaveName: "Legacy" });
  });

  test("breaks equal retention times by normalized save name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    for (const name of ["beta", "Alpha"]) {
      await upload(t, auth, profileNamed(name), null, meaningful(`tie-${name}`, Date.now()));
    }
    for (let slot = 3; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await upload(t, auth, profileNamed(`Career ${slot}`), null, meaningful(`tie-${slot}`, Date.now()));
    }

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(t, auth, profileNamed("Incoming")))
      .resolves.toMatchObject({ ok: true, evictedSaveName: "Alpha" });
  });

  test("an existing slot revision neither evicts nor reports a career", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    for (let slot = 1; slot <= 10; slot += 1) {
      await upload(t, auth, profileNamed(`Career ${slot}`));
    }

    const result = await upload(t, auth, profileNamed("Career 1"), 1);
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(result).not.toHaveProperty("evictedSaveName");
    expect(await listedSaveNames(t, auth)).toHaveLength(10);
  });

  test("eviction removes the whole slot while retaining account achievements and events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: Date.now(),
    });
    await upload(t, auth, profileNamed("Career 1"), null, meaningful("evict-1", Date.now()));
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: false, now: Date.now() + 1,
    });
    await upload(t, auth, profileNamed("Career 1"), 1);
    for (let slot = 2; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await upload(t, auth, profileNamed(`Career ${slot}`), null, meaningful(`evict-${slot}`, Date.now()));
    }
    const evictedContentIds = await t.run(async (ctx) => {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", auth.driverId)).unique();
      if (!driver) throw new Error("driver missing");
      await ctx.db.patch(driver._id, { publicSaveName: undefined });
      await ctx.db.insert("freightFateAchievements", {
        driverId: auth.driverId, achievementKey: "retained-achievement", createdAt: Date.now(),
      });
      await ctx.db.insert("freightFateDriverEvents", {
        driverId: auth.driverId, eventId: "retained-event", eventType: "test",
        summary: "Retained account event", occurredAt: Date.now(), createdAt: Date.now(),
      });
      return (await ctx.db.query("freightFateSaves")
        .withIndex("by_slot", (q) => q.eq("driverId", auth.driverId).eq("saveName", "Career 1"))
        .collect()).map((row) => row.contentId);
    });

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(t, auth, profileNamed("Incoming")))
      .resolves.toMatchObject({ ok: true, evictedSaveName: "Career 1" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateSaves")
        .withIndex("by_slot", (q) => q.eq("driverId", auth.driverId).eq("saveName", "Career 1"))
        .collect()).toHaveLength(0);
      for (const contentId of evictedContentIds) expect(await ctx.db.get(contentId)).toBeNull();
      expect(await ctx.db.query("freightFateMeaningfulPlayOperations")
        .withIndex("by_driver_save_accepted", (q) =>
          q.eq("driverId", auth.driverId).eq("saveName", "Career 1"),
        ).collect()).toHaveLength(0);
      expect(await ctx.db.query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId)).unique()).toBeNull();
      expect(await ctx.db.query("freightFateAchievements")
        .withIndex("by_driver_achievement", (q) =>
          q.eq("driverId", auth.driverId).eq("achievementKey", "retained-achievement"),
        ).unique()).not.toBeNull();
      expect(await ctx.db.query("freightFateDriverEvents")
        .withIndex("by_driver_event", (q) =>
          q.eq("driverId", auth.driverId).eq("eventId", "retained-event"),
        ).unique()).not.toBeNull();
    });
  });

  test("blocks retention without accepting incoming changes when target content is inconsistent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const t = setup();
    const auth = await provisionedDriver(t);
    for (let slot = 1; slot <= 10; slot += 1) {
      vi.setSystemTime(new Date(`2026-08-${String(slot).padStart(2, "0")}T00:00:00Z`));
      await upload(t, auth, profileNamed(`Career ${slot}`), null, meaningful(`blocked-${slot}`, Date.now()));
    }
    await t.mutation(api.freightFate.setProfileSharing, {
      ...auth, enabled: true, now: Date.now() + 1,
    });
    await t.run(async (ctx) => {
      const oldest = await ctx.db.query("freightFateSaves")
        .withIndex("by_slot", (q) => q.eq("driverId", auth.driverId).eq("saveName", "Career 1"))
        .unique();
      if (!oldest) throw new Error("oldest slot missing");
      await ctx.db.delete(oldest.contentId);
    });

    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    await expect(upload(
      t,
      auth,
      profileNamed("Incoming"),
      null,
      meaningful("blocked-incoming", Date.now()),
    )).resolves.toMatchObject({ ok: false, reason: "retention_blocked" });
    expect(await listedSaveNames(t, auth)).toHaveLength(10);
    expect(await listedSaveNames(t, auth)).not.toContain("Incoming");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateMeaningfulPlayOperations")
        .withIndex("by_driver_operation", (q) =>
          q.eq("driverId", auth.driverId).eq("operationId", "blocked-incoming"),
        ).unique()).toBeNull();
      expect(await ctx.db.query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId)).unique()).toBeNull();
    });
  });

  test("retrying a successful eleventh upload does not evict another career", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    for (let slot = 1; slot <= 10; slot += 1) {
      await upload(t, auth, profileNamed(`Career ${slot}`));
    }
    await expect(upload(t, auth, profileNamed("Incoming")))
      .resolves.toMatchObject({ ok: true, revision: 1, evictedSaveName: "Career 1" });
    const afterSuccess = await listedSaveNames(t, auth);

    await expect(upload(t, auth, profileNamed("Incoming"), null))
      .resolves.toMatchObject({ ok: false, reason: "conflict", latestRevision: 1 });
    expect(await listedSaveNames(t, auth)).toEqual(afterSuccess);
  });

  test("deleting the accepted source slot also removes its public projection", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await uploadMeaningfully(t, auth, validProfile(), null, "delete-selected-source");
    expect(await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first()))
      .not.toBeNull();

    await expect(t.mutation(api.freightFateSaves.deleteSaveSlot, {
      ...auth, saveName: "Road Star",
    })).resolves.toMatchObject({ ok: true, deletedRevisions: 1 });
    expect(await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first()))
      .toBeNull();
  });

  test("lazily validates and signs a legacy unsigned authenticated revision", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const payload = validProfile();
    const content = contentFor(payload);
    await t.run(async (ctx) => {
      const contentId = await ctx.db.insert("freightFateSaveContent", {
        driverId: auth.driverId, content,
      });
      await ctx.db.insert("freightFateSaves", {
        driverId: auth.driverId, saveName: payload.name, revision: 1,
        saveVersion: payload.version, contentHash: hash(content), sizeBytes: content.byteLength,
        summary: "legacy", contentId, createdAt: Date.now(),
      });
    });
    const downloaded = await t.action(anyApi.freightFateSaveActions.downloadValidatedSave, {
      ...auth, saveName: payload.name, now: Date.now(),
    });
    expect(downloaded).toMatchObject({
      ok: true, revision: 1, keyId: "2026-07-test", validatorVersion: 1,
    });
    const row = await t.run((ctx) => ctx.db.query("freightFateSaves").first());
    expect(row?.sig).toEqual(expect.any(String));
  });
});

describe("per-computer tokens", () => {
  test("a second computer's token uploads to the same slots and stamps its last use", async () => {
    const t = setup();
    const subject = "user_cloud";
    const auth = await provisionedDriver(t, subject);
    const as = t.withIdentity({ subject });

    const laptop = await connectComputer(t, subject, "Laptop");
    const laptopAuth = {
      driverId: auth.driverId,
      driverTokenHash: createHash("sha256").update(laptop).digest("hex"),
    };

    await expect(upload(t, auth)).resolves.toMatchObject({ ok: true, revision: 1 });
    await expect(
      upload(t, laptopAuth, { ...validProfile(), money: 9_100 }, 1),
    ).resolves.toMatchObject({ ok: true, revision: 2 });

    // The upload marked the laptop row so the setup page can say when that
    // computer last played; the desktop's original token has no row to stamp.
    const computers = await as.query(api.freightFate.getMyComputers, {});
    const laptopRow = computers!.computers.find((c) => c.label === "Laptop")!;
    expect(laptopRow.lastUsedAt).not.toBeNull();
  });
});

describe("verified snapshot backfill", () => {
  test("re-validates and stamps pre-validator revisions, legacy market included", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_backfill");

    // A career from before the cargo-class expansion: only 8 of the current
    // 16 market classes, uploaded before the validator existed (no sig, and
    // an old-format snapshot without sourceRevision/validatorVersion).
    const payload = validProfile();
    payload.market.multipliers = Object.fromEntries(
      invariants.marketCargoKeys.slice(0, 8).map((key) => [key, 1]),
    );
    const content = contentFor(payload);
    const savedAt = Date.now() - 86_400_000;
    await t.run(async (ctx) => {
      const contentId = await ctx.db.insert("freightFateSaveContent", {
        driverId: auth.driverId,
        content,
      });
      await ctx.db.insert("freightFateSaves", {
        driverId: auth.driverId,
        saveName: payload.name,
        revision: 21,
        saveVersion: payload.version,
        contentHash: hash(content),
        sizeBytes: content.byteLength,
        summary: "Road Star, level 4",
        contentId,
        createdAt: savedAt,
      });
      await ctx.db.insert("freightFateProfileSnapshots", {
        driverId: auth.driverId,
        version: 1,
        level: 4,
        careerTitle: "Level 4 driver",
        lastSavedCity: "Chicago, Illinois",
        deliveries: 12,
        milesDriven: 4_100,
        reputation: 70,
        capturedAt: savedAt,
        updatedAt: savedAt,
      });
    });

    const report = await t.action(
      anyApi.freightFateSaveActions.backfillVerifiedSnapshots,
      { now: Date.now() },
    );
    expect(report).toEqual([
      { driverId: auth.driverId, revision: 21, ok: true },
    ]);

    await t.run(async (ctx) => {
      const snapshot = await ctx.db
        .query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId))
        .unique();
      expect(snapshot).toMatchObject({
        sourceRevision: 21,
        validatorVersion: 1,
        deliveries: 12,
        capturedAt: savedAt,
      });
      const row = await ctx.db
        .query("freightFateSaves")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId))
        .unique();
      expect(row!.sig).toBeTruthy();
      expect(row!.validatorVersion).toBe(1);
    });

    // A second run finds nothing left to repair.
    await expect(
      t.action(anyApi.freightFateSaveActions.backfillVerifiedSnapshots, { now: Date.now() }),
    ).resolves.toEqual([]);
  });
});
