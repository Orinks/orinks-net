import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import invariants from "../data/freight-fate-profile-invariants.json";
import { signSharedProfile } from "./freightFateSharedProfileSigning";
import { freightFateSaveSlotName } from "../lib/freight-fate-save-name";
import {
  canonicalSharedProfile,
  validateSharedProfile,
} from "./freightFateSharedProfileValidation";

function validProfile() {
  return {
    version: 4,
    name: "Road Star",
    money: 9_000,
    current_city: "chicago_il_us",
    truck_damage_pct: 2,
    tire_wear_pct: 3,
    road_grime_pct: 4,
    truck_fuel_gal: 125,
    game_hours: 240,
    tutorial_done: true,
    truck: "rig",
    owned_trucks: ["rig"],
    upgrades: {},
    active_trip: null,
    dispatch_board_cache: null,
    fatigue: 10,
    pay_advance: 0,
    pay_advance_used_for_load: false,
    career: {
      xp: 4_800,
      reputation: 70,
      deliveries: 12,
      on_time_deliveries: 11,
      total_miles: 4_100,
      total_earnings: 21_500,
    },
    market: {
      seed: 1234,
      day: 10,
      multipliers: Object.fromEntries(invariants.marketCargoKeys.map((key) => [key, 1])),
    },
    hos: {
      driving_min: 0,
      duty_min: 0,
      since_break_min: 0,
      status: "off_duty",
      non_driving_min: 600,
      off_duty_min: 600,
      warned: [],
      history: [],
      split_rest_history: [],
      split_credit_key: null,
    },
    achievements: [],
    achievement_stats: {},
  };
}

describe("validateSharedProfile", () => {
  test("accepts a current self-consistent career", () => {
    expect(validateSharedProfile(validProfile(), "Road Star")).toMatchObject({ ok: true });
  });

  test("matches the game's Unicode cloud-slot sanitizer", () => {
    const profile = { ...validProfile(), name: "José 🚚" };
    expect(freightFateSaveSlotName(profile.name)).toBe("José _");
    expect(validateSharedProfile(profile, "José _")).toMatchObject({ ok: true });
  });

  test.each([
    ["unknown top-level field", { debug_money: 99 }, "invalid_schema"],
    ["unknown city", { current_city: "moon_base" }, "invalid_city"],
    ["out-of-range wear", { tire_wear_pct: 101 }, "invalid_range"],
    ["unowned truck", { truck: "heavy_hauler" }, "invalid_possession"],
  ])("rejects %s", (_label, override, reason) => {
    expect(validateSharedProfile({ ...validProfile(), ...override }, "Road Star"))
      .toMatchObject({ ok: false, reason });
  });

  test("rejects money and XP that the recorded career cannot support", () => {
    expect(validateSharedProfile({ ...validProfile(), money: 1_000_000 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "impossible_money" });
    expect(validateSharedProfile({
      ...validProfile(),
      career: { ...validProfile().career, xp: 50_000 },
    }, "Road Star")).toMatchObject({ ok: false, reason: "impossible_xp" });
  });

  test("accepts a legacy market carrying only the original cargo classes", () => {
    // Careers begun before a cargo-class expansion keep the smaller
    // multiplier set (seen in the wild: 8 of the current 16 classes).
    const legacy = validProfile();
    legacy.market.multipliers = Object.fromEntries(
      invariants.marketCargoKeys.slice(0, 8).map((key) => [key, 1]),
    );
    expect(validateSharedProfile(legacy, "Road Star")).toMatchObject({ ok: true });
  });

  test("rejects empty or unknown market multipliers", () => {
    const empty = validProfile();
    empty.market.multipliers = {};
    expect(validateSharedProfile(empty, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_market" });
    const unknown = validProfile();
    unknown.market.multipliers = { antigravity: 1 };
    expect(validateSharedProfile(unknown, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_market" });
  });

  test("rejects unknown achievements and unsupported save versions", () => {
    expect(validateSharedProfile({ ...validProfile(), achievements: ["invented"] }, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_achievement" });
    expect(validateSharedProfile({ ...validProfile(), version: 99 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
  });
});

describe("signed profile envelope bytes", () => {
  test("matches the game's canonical form byte for byte", () => {
    // Mirror of Freight Fate's
    // tests/test_cloud_saves.py::test_canonical_profile_matches_the_server_byte_for_byte.
    // Both suites pin the same payload to the same string; if either side's
    // canonicalization drifts, one of them fails instead of restores breaking
    // silently in production. Change them together or not at all.
    const payload = {
      b: [1.5, 2.0, 1e-7, 0.00001],
      a: { x: -0.0, y: 129881.73999999999, z: 29571.0 },
      n: null,
      s: "café — truck",
      t: true,
      big: 1e21,
      tiny: 8.673617379884035e-19,
      whole: 6.0,
    };
    expect(canonicalSharedProfile(payload)).toBe(
      '{"a":{"x":0,"y":129881.73999999999,"z":29571},'
      + '"b":[1.5,2,1e-7,0.00001],"big":1e+21,"n":null,'
      + '"s":"caf\\u00e9 \\u2014 truck","t":true,'
      + '"tiny":8.673617379884035e-19,"whole":6}',
    );
  });

  test("canonicalizes recursively with ASCII escapes and verifies Ed25519", () => {
    const payload = { ...validProfile(), name: "Jos\u00e9 \ud83d\ude9a" };
    const canonical = canonicalSharedProfile(payload);
    expect(canonical).toContain("Jos\\u00e9 \\ud83d\\ude9a");
    expect(canonical.indexOf('"active_trip"')).toBeLessThan(canonical.indexOf('"career"'));

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateDer = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const signature = Buffer.from(signSharedProfile(payload, privateDer), "base64");
    expect(verify(null, Buffer.from(canonical, "utf8"), publicKey, signature)).toBe(true);
  });
});
