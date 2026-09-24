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

describe("the profile's career title", () => {
  function titleAt(level: number, extra: Record<string, unknown>) {
    return buildVerifiedProfileSnapshot({
      driverId: "road-star-1234", saveName: "Main", revision: 1,
      payload: { ...payload({ xp: invariants.levelXp[level - 1] }), ...extra },
      now: 1_800_000_000_000, validatorVersion: 1,
    }).careerTitle;
  }

  test("a company driver past the fork takes the company ladder, as the game does", () => {
    expect(titleAt(19, { business_status: "company_driver" }))
      .toBe(invariants.companyCareerTitles[18]);
    expect(titleAt(19, { business_status: "company_driver" })).not.toMatch(/Owner-Operator/);
  });

  test("a company driver who declined the buy-in takes it early", () => {
    expect(titleAt(12, { business_status: "company_driver", owner_operator_declined: true }))
      .toBe(invariants.companyCareerTitles[11]);
  });

  test("an owner-operator keeps the owner-operator ladder", () => {
    expect(titleAt(19, { business_status: "leased_owner_operator" }))
      .toBe("Settled Owner-Operator");
  });
});

describe("the profile's out-of-service orders", () => {
  function ordersFrom(extra: Record<string, unknown>) {
    return buildVerifiedProfileSnapshot({
      driverId: "road-star-1234", saveName: "Main", revision: 1,
      payload: {
        ...payload({}),
        driving_record: {
          serious_violations: [], major_offenses: [], citations: 0,
          fatigue_events: 2, repossessions: 0, carrier_terminations: 0,
        },
        ...extra,
      },
      now: 1_800_000_000_000, validatorVersion: 1,
    }).safetyRecord;
  }

  test("are the lifetime count the game saved", () => {
    expect(ordersFrom({ out_of_service_events: 3 })?.outOfServiceOrders).toBe(3);
    expect(ordersFrom({ out_of_service_events: 0 })?.outOfServiceOrders).toBe(0);
  });

  test("are left off for a save from before the count existed", () => {
    expect(ordersFrom({})).toBeDefined();
    expect(ordersFrom({})).not.toHaveProperty("outOfServiceOrders");
  });

  test("are left off when the count is not a whole non-negative number", () => {
    for (const bad of [-1, 1.5, "3", null]) {
      expect(ordersFrom({ out_of_service_events: bad })).not.toHaveProperty("outOfServiceOrders");
    }
  });
});

describe("the profile's crashes", () => {
  function crashesFrom(extra: Record<string, unknown>) {
    return buildVerifiedProfileSnapshot({
      driverId: "road-star-1234", saveName: "Main", revision: 1,
      payload: {
        ...payload({}),
        driving_record: {
          serious_violations: [], major_offenses: [], citations: 0,
          fatigue_events: 0, repossessions: 0, carrier_terminations: 0,
          ...extra,
        },
      },
      now: 1_800_000_000_000, validatorVersion: 1,
    }).safetyRecord;
  }

  test("are the lifetime count the game saved", () => {
    expect(crashesFrom({ crashes: 2 })?.crashes).toBe(2);
    expect(crashesFrom({ crashes: 0 })?.crashes).toBe(0);
  });

  test("are left off for a save from before the count existed", () => {
    expect(crashesFrom({})).toBeDefined();
    expect(crashesFrom({})).not.toHaveProperty("crashes");
  });

  test("are left off when the count is not a whole non-negative number", () => {
    for (const bad of [-1, 1.5, "3", null]) {
      expect(crashesFrom({ crashes: bad })).not.toHaveProperty("crashes");
    }
  });
});

describe("the profile's reputation", () => {
  test("is the standing the game saved: the ledger less the driving record", () => {
    // A pinned ledger beside a bad record: the game shows 60, so the profile does.
    expect(snapshot({ reputation: 98, standing: 60 }).reputation).toBe(60);
  });

  test("falls back to the raw ledger for a save from before the standing existed", () => {
    expect(snapshot({ reputation: 70 }).reputation).toBe(70);
  });
});
