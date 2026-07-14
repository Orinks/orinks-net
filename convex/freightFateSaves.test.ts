/// <reference types="vite/client" />
import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import invariants from "../data/freight-fate-profile-invariants.json";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

function validProfile() {
  return {
    version: 4, name: "Road Star", money: 9_000, current_city: "chicago_il_us",
    truck_damage_pct: 2, tire_wear_pct: 3, road_grime_pct: 4, truck_fuel_gal: 125,
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

  test("a self-contradicting upload stamps the sticky integrity verdict", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const flagOf = async () => {
      const report = await t.query(internal.freightFateAdmin.listClientVersions, {});
      return report.find((row) => row.driverId === auth.driverId)?.integrityFlag ?? null;
    };

    // A malformed upload is damage or version drift, not cheat evidence.
    const unknownField = Object.assign(validProfile(), { cheat_menu: true });
    await expect(upload(t, auth, unknownField))
      .resolves.toMatchObject({ ok: false, reason: "invalid_schema" });
    expect(await flagOf()).toBeNull();

    // Money the career never earned is rejected AND stamps the verdict.
    await expect(upload(t, auth, { ...validProfile(), money: 1_000_000 }))
      .resolves.toMatchObject({ ok: false, reason: "impossible_money" });
    expect(await flagOf()).toBe("impossible_money");

    // The first verdict is sticky: new evidence does not overwrite it.
    const inflatedXp = validProfile();
    inflatedXp.career.total_miles = 100;
    await expect(upload(t, auth, inflatedXp))
      .resolves.toMatchObject({ ok: false, reason: "impossible_xp" });
    expect(await flagOf()).toBe("impossible_money");

    // Honest cloud backups keep working while the flag awaits review.
    await expect(upload(t, auth)).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(await flagOf()).toBe("impossible_money");

    // After a reviewed clear, fresh evidence stamps a fresh verdict.
    await t.mutation(internal.freightFateAdmin.setIntegrityFlag, {
      driverId: auth.driverId, flag: null,
    });
    await expect(upload(t, auth, inflatedXp, 1))
      .resolves.toMatchObject({ ok: false, reason: "impossible_xp" });
    expect(await flagOf()).toBe("impossible_xp");
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
