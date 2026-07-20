/// <reference types="vite/client" />
import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import invariants from "../data/freight-fate-profile-invariants.json";
import { REJECTED_UPLOAD_TTL_MS } from "./freightFateSaves";

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

function contentFor(payload: unknown) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hash(content: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

async function provisionedDriver(t: ReturnType<typeof setup>, subject = "user_cloud") {
  const result = await t.withIdentity({ subject }).mutation(api.freightFate.provisionDriver, {
    displayName: `Cloud Hauler ${subject}`, visibility: "private", now: Date.now(),
  });
  return {
    driverId: result.driverId,
    driverTokenHash: createHash("sha256").update(result.token!).digest("hex"),
  };
}

async function upload(
  t: ReturnType<typeof setup>,
  auth: { driverId: string; driverTokenHash: string },
  payload = validProfile(),
  parentRevision: number | null = null,
) {
  const content = contentFor(payload);
  return t.action(anyApi.freightFateSaveActions.uploadValidatedSave, {
    ...auth, saveName: payload.name, saveVersion: payload.version, parentRevision,
    contentHash: hash(content), content, summary: "Road Star, level 4", now: Date.now(),
  });
}

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY = privateKey
    .export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID = "2026-07-test";
});

afterEach(() => {
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
    await expect(upload(t, auth)).resolves.toMatchObject({ ok: true, revision: 1 });
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
    });
  });

  test("keeps the first verified slot as the public profile owner", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await upload(t, auth);

    const experiment = validProfile();
    experiment.name = "Experiment";
    experiment.money = 0;
    experiment.career.xp = 0;
    experiment.career.deliveries = 0;
    experiment.career.on_time_deliveries = 0;
    experiment.career.total_miles = 0;
    experiment.career.total_earnings = 0;
    await expect(upload(t, auth, experiment))
      .resolves.toMatchObject({ ok: true, revision: 1 });

    const afterExperiment = await t.run((ctx) => ctx.db
      .query("freightFateProfileSnapshots").first());
    expect(afterExperiment).toMatchObject({
      sourceSaveName: "Road Star",
      level: 4,
      deliveries: 12,
      milesDriven: 4_100,
    });

    const updatedOwner = validProfile();
    updatedOwner.career.reputation = 75;
    await upload(t, auth, updatedOwner, 1);

    const afterOwnerUpdate = await t.run((ctx) => ctx.db
      .query("freightFateProfileSnapshots").first());
    expect(afterOwnerUpdate).toMatchObject({
      sourceSaveName: "Road Star",
      sourceRevision: 2,
      reputation: 75,
    });

    await t.mutation(api.freightFateSaves.deleteSaveSlot, {
      ...auth, saveName: "Experiment",
    });
    expect(await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first()))
      .not.toBeNull();

    await t.mutation(api.freightFateSaves.deleteSaveSlot, {
      ...auth, saveName: "Road Star",
    });
    expect(await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first()))
      .toBeNull();

    await expect(upload(t, auth, experiment))
      .resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first()))
      .toMatchObject({ sourceSaveName: "Experiment", level: 1, deliveries: 0 });
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

  test("deleting the accepted source slot also removes its public projection", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    await upload(t, auth);
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

    const laptop = await as.mutation(api.freightFate.addComputer, {
      label: "Laptop",
      now: Date.now(),
    });
    const laptopAuth = {
      driverId: auth.driverId,
      driverTokenHash: createHash("sha256").update(laptop.token).digest("hex"),
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
