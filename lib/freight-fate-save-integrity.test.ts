import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { screenSaveBlob } from "./freight-fate-save-integrity";

function blobOf(profile: Record<string, unknown>): ArrayBuffer {
  const bytes = gzipSync(JSON.stringify(profile));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// A modest, self-consistent career; mirrors make_profile in the game repo's
// tests/test_save_forensics.py.
function profile(overrides: Record<string, unknown> = {}, career: Record<string, unknown> = {}) {
  return {
    version: 4,
    _signature: "f".repeat(64),
    money: 9_000,
    pay_advance: 0,
    truck: "rig",
    owned_trucks: ["rig"],
    upgrades: {},
    career: {
      xp: 4_800,
      deliveries: 12,
      on_time_deliveries: 11,
      total_miles: 4_100,
      total_earnings: 21_500,
      ...career,
    },
    ...overrides,
  };
}

describe("screenSaveBlob", () => {
  test("a self-consistent career passes", () => {
    expect(screenSaveBlob(blobOf(profile()))).toBe("ok");
  });

  test("garbage bytes are unreadable, not a crash", () => {
    expect(screenSaveBlob(new TextEncoder().encode("not gzip").buffer as ArrayBuffer)).toBe(
      "unreadable",
    );
  });

  test("a stripped signature on a version-4 save is flagged", () => {
    const edited = profile();
    delete (edited as Record<string, unknown>)._signature;
    expect(screenSaveBlob(blobOf(edited))).toBe("unsigned");
  });

  test("a pre-signature save version is not falsely flagged as unsigned", () => {
    const legacy = profile({ version: 3 });
    delete (legacy as Record<string, unknown>)._signature;
    expect(screenSaveBlob(blobOf(legacy))).toBe("ok");
  });

  test("edited money beyond lifetime earnings is impossible", () => {
    expect(screenSaveBlob(blobOf(profile({ money: 1_000_113_758 })))).toBe("impossible_money");
  });

  test("a heavy hauler and full upgrades count as spending", () => {
    // 9,000 on hand + 113,000 of gear against only 21,500 earned.
    const geared = profile({
      truck: "heavy_hauler",
      owned_trucks: ["rig", "heavy_hauler"],
      upgrades: { engine_tune: 2, aero_kit: 1, long_range_tank: 1, reinforced_brakes: 1 },
    });
    expect(screenSaveBlob(blobOf(geared))).toBe("impossible_money");
  });

  test("honestly earned gear passes", () => {
    const earned = profile(
      {
        money: 20_000,
        truck: "heavy_hauler",
        owned_trucks: ["rig", "heavy_hauler"],
      },
      { total_earnings: 80_000, total_miles: 16_000, xp: 19_000 },
    );
    expect(screenSaveBlob(blobOf(earned))).toBe("ok");
  });

  test("edited XP beyond the version-4 per-mile ceiling is impossible", () => {
    expect(screenSaveBlob(blobOf(profile({}, { xp: 50_000 })))).toBe("impossible_xp");
  });

  test("newer save versions skip the XP rule but keep the money rule", () => {
    // Version 10 (the 1.9 line) has XP multipliers this screen does not know.
    expect(screenSaveBlob(blobOf(profile({ version: 10 }, { xp: 50_000 })))).toBe("ok");
    expect(screenSaveBlob(blobOf(profile({ version: 10, money: 999_999 })))).toBe(
      "impossible_money",
    );
  });
});
