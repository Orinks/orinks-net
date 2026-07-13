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

  test("rejects unknown achievements and unsupported save versions", () => {
    expect(validateSharedProfile({ ...validProfile(), achievements: ["invented"] }, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_achievement" });
    expect(validateSharedProfile({ ...validProfile(), version: 99 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
  });
});

describe("signed profile envelope bytes", () => {
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
