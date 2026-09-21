import { describe, expect, test } from "vitest";
import { buildVerifiedProfileSnapshot } from "./freightFateProfileProjection";
import invariants from "../data/freight-fate-profile-invariants.json";

function payload(career: Record<string, number>) {
  return {
    version: invariants.sourceSaveVersion, name: "Road Star", money: 9_000,
    current_city: "chicago_il_us",
    truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4 } },
    game_hours: 240, truck: "rig", owned_trucks: ["rig"], upgrades: {},
    career: { xp: 4_800, deliveries: 12, on_time_deliveries: 11, total_miles: 4_100, total_earnings: 21_500, ...career },
    achievements: [], achievement_stats: {},
  };
}

function snapshot(career: Record<string, number>) {
  return buildVerifiedProfileSnapshot({
    driverId: "road-star-1234", saveName: "Main", revision: 1,
    payload: payload(career), now: 1_800_000_000_000, validatorVersion: 1,
  });
}

describe("the profile's reputation", () => {
  test("is the standing the game saved: the ledger less the driving record", () => {
    // A pinned ledger beside a bad record: the game shows 60, so the profile does.
    expect(snapshot({ reputation: 98, standing: 60 }).reputation).toBe(60);
  });

  test("falls back to the raw ledger for a save from before the standing existed", () => {
    expect(snapshot({ reputation: 70 }).reputation).toBe(70);
  });
});
