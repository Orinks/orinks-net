/// <reference types="vite/client" />
import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import invariants from "../data/freight-fate-profile-invariants.json";
import uploads from "../test-fixtures/freight-fate-career-2-uploads.json";

// Career 2.0 backups as the game sends them: the upload bodies in the fixture
// were written by feat/career-2.0's own ff-core, so these tests check the
// real 2.0 save shape (home terminal, home city, parked facility, the
// turnpike notice, a regional carrier, an empty carrier) and not a copy of it.
const modules = import.meta.glob("./**/*.ts");
let operations = 0;
type Auth = { driverId: string; driverTokenHash: string };

function setup() {
  return convexTest(schema, modules);
}

function bytes(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function provisionedDriver(t: ReturnType<typeof setup>, subject: string): Promise<Auth> {
  const result = await t.withIdentity({ subject }).mutation(api.freightFate.provisionDriver, {
    displayName: `Alaska Hauler ${subject}`, visibility: "private", now: Date.now(),
  });
  const now = Date.now();
  const started = await t.mutation(api.freightFateActivation.startActivation, {
    clientKey: `${subject}:computer`, now,
  });
  await t.withIdentity({ subject }).mutation(api.freightFateActivation.claimActivation, {
    userCode: started.userCode, label: "My computer",
  });
  const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
    deviceCodeHash: createHash("sha256").update(started.deviceCode, "utf8").digest("hex"), now,
  });
  return {
    driverId: result.driverId,
    driverTokenHash: createHash("sha256").update(redeemed!.token).digest("hex"),
  };
}

function sendGameUpload(
  t: ReturnType<typeof setup>,
  auth: Auth,
  save: { version: number; content: string; contentHash: string },
  saveName: string,
  parentRevision: number | null,
) {
  const now = Date.now();
  return t.action(anyApi.freightFateSaveActions.uploadValidatedSave, {
    ...auth, saveName, saveVersion: save.version, parentRevision,
    contentHash: save.contentHash, content: bytes(save.content), summary: saveName, now,
    meaningfulPlay: { operationId: `upload-${(operations += 1)}`, occurredAt: now, reason: "delivery_completed" },
    reviewAware: true,
  });
}

// The same driver's 1.9 career, named the same, in its own plain slot.
function stableRoadStar() {
  const payload = {
    version: invariants.sourceSaveVersion, name: "Road Star", created_line: "1.9", money: 9_000,
    current_city: "chicago_il_us",
    truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4 } },
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
  const content = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return {
    version: payload.version,
    content: content.toString("base64"),
    contentHash: createHash("sha256").update(content).digest("hex"),
  };
}

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY = privateKey
    .export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID = "2026-07-test";
  process.env.FREIGHT_FATE_REVIEW_SECRET = "test-review-secret-that-is-long-enough-000";
});

afterEach(() => {
  delete process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY;
  delete process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID;
  delete process.env.FREIGHT_FATE_REVIEW_SECRET;
});

describe("Career 2.0 cloud backups from the game", () => {
  test("a regional driver backs up, lists and restores beside a same-name 1.9 career", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_alaska");
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now: Date.now() });
    const regional = uploads.saves.regional;

    expect(await sendGameUpload(t, auth, stableRoadStar(), "Road Star", null))
      .toMatchObject({ ok: true, revision: 1 });
    expect(await sendGameUpload(t, auth, regional, "Road Star (Career 2)", null))
      .toMatchObject({ ok: true, revision: 1 });
    // The plain slot is the 1.9 career's; a 2.0 save cannot land there.
    expect(await sendGameUpload(t, auth, regional, "Road Star", 1))
      .toMatchObject({ ok: false, reason: "invalid_name" });

    const listed = await t.query(api.freightFateSaves.listSaves, auth);
    expect(listed.ok && [...new Set(listed.saves.map((save) => save.saveName))].sort())
      .toEqual(["Road Star", "Road Star (Career 2)"]);
    for (const saveName of ["Road Star", "Road Star (Career 2)"]) {
      expect(await t.action(anyApi.freightFateSaveActions.downloadValidatedSave, {
        ...auth, saveName, now: Date.now(),
      })).toMatchObject({ ok: true, saveName, revision: 1 });
    }

    await t.mutation(api.freightFateSaves.setPublicSave, {
      ...auth, saveName: "Road Star (Career 2)", now: Date.now(),
    });
    expect(await sendGameUpload(t, auth, regional, "Road Star (Career 2)", 1))
      .toMatchObject({ ok: true, revision: 2 });
    const snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({
      sourceSaveName: "Road Star (Career 2)",
      businessIdentity: "Company driver for Chatanika Freight Lines",
      carrierName: "Chatanika Freight Lines",
      lastSavedCity: "Fairbanks, Alaska",
    });
    expect(snapshot?.endorsements).toContain("livestock handling");
    expect(snapshot?.visitedPlaces?.map((place) => place.state)).toEqual(["Alaska", "Yukon"]);
  });

  test("a company driver with no carrier near home backs up with no carrier shown", async () => {
    const t = setup();
    const auth = await provisionedDriver(t, "user_deadhorse");
    await t.mutation(api.freightFate.setProfileSharing, { ...auth, enabled: true, now: Date.now() });
    expect(await sendGameUpload(t, auth, uploads.saves.unassigned, "No Carrier (Career 2)", null))
      .toMatchObject({ ok: true, revision: 1 });
    const snapshot = await t.run((ctx) => ctx.db.query("freightFateProfileSnapshots").first());
    expect(snapshot).toMatchObject({ businessIdentity: "Company driver" });
    expect(snapshot?.carrierName).toBeUndefined();
  });
});
