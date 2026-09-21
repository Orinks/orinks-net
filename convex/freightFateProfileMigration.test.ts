/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import invariants from "../data/freight-fate-profile-invariants.json";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

function profile(name: string, achievements: string[]) {
  return {
    version: invariants.sourceSaveVersion, name, money: 9_000,
    current_city: "chicago_il_us",
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
    achievements, achievement_stats: {},
  };
}

function encoded(payload: unknown) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { content, hash: createHash("sha256").update(bytes).digest("hex") };
}

async function seedDriver(
  t: ReturnType<typeof setup>,
  driverId: string,
  careers: Array<{
    name: string;
    achievements: string[];
    createdAt: number;
    verified?: boolean;
    corrupt?: boolean;
    storedVersion?: number;
  }>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("freightFateDrivers", {
      driverId, displayName: driverId, visibility: "public", publicSaveName: careers[0]?.name,
      sharingConsentVersion: 1, sharingConsentedAt: 1, createdAt: 1, updatedAt: 1,
    });
    for (const [index, career] of careers.entries()) {
      const payload = profile(career.name, career.achievements);
      const stored = encoded(payload);
      const contentId = await ctx.db.insert("freightFateSaveContent", {
        driverId, content: career.corrupt ? new Uint8Array([1, 2, 3]).buffer : stored.content,
      });
      await ctx.db.insert("freightFateSaves", {
        driverId, saveName: career.name, revision: 1,
        saveVersion: career.storedVersion ?? payload.version,
        contentHash: stored.hash, sizeBytes: stored.content.byteLength,
        summary: `${career.name}, level 4`, contentId, createdAt: career.createdAt,
        ...(career.verified === false ? {} : {
          sig: `signature-${index}`, keyId: "2026-08-preview",
          signedAt: new Date(career.createdAt).toISOString(), validatorVersion: 1,
        }),
      });
    }
    if (careers[0]) {
      await ctx.db.insert("freightFateProfileSnapshots", {
        driverId, version: 1, level: 4, careerTitle: "Road Driver",
        lastSavedCity: "Chicago, Illinois", deliveries: 12, milesDriven: 4_100,
        reputation: 70, capturedAt: careers[0].createdAt, updatedAt: careers[0].createdAt,
        sourceSaveName: careers[0].name, sourceRevision: 1, validatorVersion: 1,
      });
    }
  });
}

async function addRevision(
  t: ReturnType<typeof setup>,
  args: {
    driverId: string;
    saveName: string;
    revision: number;
    achievements: string[];
    createdAt: number;
    corrupt?: boolean;
    storedVersion?: number;
  },
) {
  const payload = profile(args.saveName, args.achievements);
  const stored = encoded(payload);
  await t.run(async (ctx) => {
    const contentId = await ctx.db.insert("freightFateSaveContent", {
      driverId: args.driverId,
      content: args.corrupt ? new Uint8Array([4, 5, 6]).buffer : stored.content,
    });
    await ctx.db.insert("freightFateSaves", {
      driverId: args.driverId,
      saveName: args.saveName,
      revision: args.revision,
      saveVersion: args.storedVersion ?? payload.version,
      contentHash: stored.hash,
      sizeBytes: stored.content.byteLength,
      summary: `${args.saveName}, level 4`,
      contentId,
      sig: `signature-${args.revision}`,
      keyId: "2026-08-preview",
      signedAt: new Date(args.createdAt).toISOString(),
      validatorVersion: 1,
      createdAt: args.createdAt,
    });
  });
}

async function runBatch(t: ReturnType<typeof setup>, cursor: string | null = null, limit = 10) {
  return t.action(anyApi.freightFateProfileMigration.runBatch, {
    secret: "test-preview-secret", cursor, limit,
  });
}

beforeEach(() => {
  process.env.FREIGHT_FATE_PROFILE_MIGRATION_MODE = "preview";
  process.env.FREIGHT_FATE_PROFILE_MIGRATION_SECRET = "test-preview-secret";
});

afterEach(() => {
  delete process.env.FREIGHT_FATE_PROFILE_MIGRATION_MODE;
  delete process.env.FREIGHT_FATE_PROFILE_MIGRATION_SECRET;
});

describe("preview account-profile migration", () => {
  test("requires both server preview mode and the server secret", async () => {
    const t = setup();
    delete process.env.FREIGHT_FATE_PROFILE_MIGRATION_MODE;
    await expect(runBatch(t)).rejects.toThrow("preview-only");
    process.env.FREIGHT_FATE_PROFILE_MIGRATION_MODE = "preview";
    await expect(t.action(anyApi.freightFateProfileMigration.runBatch, {
      secret: "wrong", cursor: null, limit: 1,
    })).rejects.toThrow("preview-only");
  });

  test.each([
    ["Alpha", "Beta"],
    ["Beta", "Alpha"],
  ])("unions verified careers independent of upload order: %s then %s", async (first, second) => {
    const t = setup();
    await seedDriver(t, "multi", [
      { name: first, achievements: ["first_delivery", "five_deliveries"], createdAt: 100 },
      { name: second, achievements: ["first_delivery", "hundred_grand"], createdAt: 200 },
    ]);
    const before = await t.run(async (ctx) => ({
      driver: await ctx.db.query("freightFateDrivers").first(),
      snapshot: await ctx.db.query("freightFateProfileSnapshots").first(),
    }));

    await expect(runBatch(t)).resolves.toMatchObject({
      done: true, scannedDrivers: 1, scannedCareers: 2,
      achievementsInserted: 3, fallbackOperationsInserted: 2, errors: 0,
    });
    const state = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("freightFateAchievements").collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
      events: await ctx.db.query("freightFateDriverEvents").collect(),
      driver: await ctx.db.query("freightFateDrivers").first(),
      snapshot: await ctx.db.query("freightFateProfileSnapshots").first(),
    }));
    expect(state.achievements.map((row) => row.achievementKey).sort()).toEqual([
      "first_delivery", "five_deliveries", "hundred_grand",
    ]);
    expect(state.achievements.every((row) => row.earnedAt === undefined)).toBe(true);
    expect(state.operations.map((row) => [row.saveName, row.acceptedAt]).sort()).toEqual([
      ["Alpha", first === "Alpha" ? 100 : 200],
      ["Beta", first === "Beta" ? 100 : 200],
    ]);
    expect(state.events).toEqual([]);
    expect(state.driver?.publicSaveName).toBe(before.driver?.publicSaveName);
    expect(state.snapshot).toEqual(before.snapshot);
  });

  test("retains earliest trustworthy event time and preserves undated imports", async () => {
    const t = setup();
    await seedDriver(t, "times", [
      { name: "Main", achievements: ["first_delivery", "five_deliveries"], createdAt: 500 },
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateAchievements", {
        driverId: "times", achievementKey: "first_delivery", name: "First delivery",
        earnedAt: 400, createdAt: 400,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "times", achievementKey: "first_delivery", name: "Later duplicate",
        earnedAt: 450, createdAt: 450,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "times", achievementKey: "five_deliveries",
        importSource: "verified_save", importedAt: 300, createdAt: 300,
      });
    });
    await runBatch(t);
    const rows = await t.run((ctx) => ctx.db.query("freightFateAchievements")
      .withIndex("by_driver", (q) => q.eq("driverId", "times")).collect());
    expect(rows.filter((row) => row.achievementKey === "first_delivery")).toHaveLength(1);
    expect(rows.find((row) => row.achievementKey === "first_delivery")?.earnedAt).toBe(400);
    expect(rows.find((row) => row.achievementKey === "five_deliveries")?.earnedAt).toBeUndefined();
  });

  test("preserves accepted meaningful recency and skips corrupt and unverified careers", async () => {
    const t = setup();
    await seedDriver(t, "mixed", [
      { name: "Good", achievements: ["first_delivery"], createdAt: 100 },
      { name: "Existing", achievements: ["five_deliveries"], createdAt: 200 },
      { name: "Unsigned", achievements: ["hundred_grand"], createdAt: 300, verified: false },
      { name: "Corrupt", achievements: ["big_payday"], createdAt: 400, corrupt: true },
      { name: "Unknown version", achievements: ["clean_delivery"], createdAt: 500, storedVersion: 999 },
    ]);
    await t.run((ctx) => ctx.db.insert("freightFateMeaningfulPlayOperations", {
      driverId: "mixed", operationId: "real-play", saveName: "Existing",
      occurredAt: 777, acceptedAt: 800, reason: "delivery_completed",
    }));
    await expect(runBatch(t)).resolves.toMatchObject({
      scannedCareers: 2, skippedCareers: 3, fallbackOperationsInserted: 1,
      fallbackOperationsAlreadyPresent: 1,
    });
    const operations = await t.run((ctx) => ctx.db.query("freightFateMeaningfulPlayOperations")
      .withIndex("by_driver_save_accepted", (q) => q.eq("driverId", "mixed").eq("saveName", "Existing"))
      .collect());
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ operationId: "real-play", acceptedAt: 800 });
    const achievements = await t.run((ctx) => ctx.db.query("freightFateAchievements").collect());
    expect(achievements.map((row) => row.achievementKey).sort()).toEqual([
      "first_delivery", "five_deliveries",
    ]);
  });

  test("uses a bounded resumable cursor and a completed rerun is idempotent", async () => {
    const t = setup();
    for (const [index, driverId] of ["driver-a", "driver-b", "driver-c"].entries()) {
      await seedDriver(t, driverId, [{
        name: `Career ${index}`, achievements: ["first_delivery"], createdAt: 100 + index,
      }]);
    }
    const first = await runBatch(t, null, 2);
    expect(first).toMatchObject({ done: false, scannedDrivers: 2 });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await runBatch(t, first.nextCursor, 2);
    expect(second).toMatchObject({ done: true, scannedDrivers: 1 });

    const before = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("freightFateAchievements").collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
    }));
    const rerun = await runBatch(t);
    expect(rerun).toMatchObject({
      achievementsInserted: 0, achievementsAlreadyPresent: 3,
      fallbackOperationsInserted: 0, fallbackOperationsAlreadyPresent: 3,
    });
    const after = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("freightFateAchievements").collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
    }));
    expect(after).toEqual(before);
  });

  test("a bounded preflight failure leaves the whole driver unchanged", async () => {
    const t = setup();
    await seedDriver(t, "overflow", [{
      name: "Main", achievements: ["first_delivery", "five_deliveries"], createdAt: 100,
    }]);
    await t.run(async (ctx) => {
      for (let index = 0; index < 11; index += 1) {
        await ctx.db.insert("freightFateAchievements", {
          driverId: "overflow", achievementKey: "five_deliveries",
          earnedAt: 1_000 + index, createdAt: 1_000 + index,
        });
      }
    });
    await expect(runBatch(t)).resolves.toMatchObject({
      errors: 1, skippedDrivers: 1, achievementsInserted: 0,
      fallbackOperationsInserted: 0,
    });
    const state = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("freightFateAchievements").collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
    }));
    expect(state.achievements).toHaveLength(11);
    expect(state.achievements.some((row) => row.achievementKey === "first_delivery")).toBe(false);
    expect(state.operations).toEqual([]);
  });

  test("migrates a legitimate legacy account with more than one hundred retained rows", async () => {
    const t = setup();
    const careers = Array.from({ length: 11 }, (_, index) => ({
      name: `Legacy ${index + 1}`,
      achievements: index === 10 ? ["hundred_grand"] : ["first_delivery"],
      createdAt: 100 + index * 10,
    }));
    await seedDriver(t, "legacy-large", careers);
    for (const [careerIndex, career] of careers.entries()) {
      for (let revision = 2; revision <= 10; revision += 1) {
        await addRevision(t, {
          driverId: "legacy-large",
          saveName: career.name,
          revision,
          achievements: career.achievements,
          createdAt: 100 + careerIndex * 10 + revision,
        });
      }
    }

    await expect(runBatch(t)).resolves.toMatchObject({
      scannedDrivers: 1,
      scannedCareers: 11,
      achievementsInserted: 2,
      fallbackOperationsInserted: 11,
      skippedDrivers: 0,
      errors: 0,
    });
    const state = await t.run(async (ctx) => ({
      saves: await ctx.db.query("freightFateSaves")
        .withIndex("by_driver", (q) => q.eq("driverId", "legacy-large")).collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
    }));
    expect(state.saves).toHaveLength(110);
    expect(state.operations).toHaveLength(11);
  });

  test("falls back to an older valid revision when the newest signed revision is unusable", async () => {
    const t = setup();
    await seedDriver(t, "fallbacks", [
      { name: "Corrupt newest", achievements: ["first_delivery"], createdAt: 100 },
      { name: "Unknown newest", achievements: ["five_deliveries"], createdAt: 200 },
    ]);
    await addRevision(t, {
      driverId: "fallbacks", saveName: "Corrupt newest", revision: 2,
      achievements: ["hundred_grand"], createdAt: 300, corrupt: true,
    });
    await addRevision(t, {
      driverId: "fallbacks", saveName: "Unknown newest", revision: 2,
      achievements: ["big_payday"], createdAt: 400, storedVersion: 999,
    });

    await expect(runBatch(t)).resolves.toMatchObject({
      scannedCareers: 2,
      skippedCareers: 0,
      achievementsInserted: 2,
      fallbackOperationsInserted: 2,
    });
    const state = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("freightFateAchievements").collect(),
      operations: await ctx.db.query("freightFateMeaningfulPlayOperations").collect(),
    }));
    expect(state.achievements.map((row) => row.achievementKey).sort()).toEqual([
      "first_delivery", "five_deliveries",
    ]);
    expect(state.operations.map((row) => [row.saveName, row.acceptedAt]).sort()).toEqual([
      ["Corrupt newest", 100],
      ["Unknown newest", 200],
    ]);
  });
});
