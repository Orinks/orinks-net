import { describe, expect, test } from "vitest";
import { buildVerifiedProfileSnapshot, publicVerifiedSnapshot } from "./freightFateProfileProjection";
import invariants from "../data/freight-fate-profile-invariants.json";
import careerTwo from "../data/freight-fate-profile-invariants-career-2.json";

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

test("public career names omit only the release suffix", () => {
  for (const [saveName, displayed] of [["Road Star (Career 2)", "Road Star"], ["Road Star - Career 2", "Road Star - Career 2"]]) {
    const stored = { ...snapshot({}), saveName } as NonNullable<Parameters<typeof publicVerifiedSnapshot>[0]>;
    expect(publicVerifiedSnapshot(stored)?.saveName).toBe(displayed);
    expect(stored.sourceSaveName).toBe("Main");
  }
});

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

describe("a Career 2.0 profile", () => {
  function snapshotOf(extra: Record<string, unknown>, career: Record<string, number> = {}) {
    return buildVerifiedProfileSnapshot({
      driverId: "road-star-1234", saveName: "Road Star (Career 2)", revision: 1,
      payload: { ...payload(career), ...extra }, now: 1_800_000_000_000, validatorVersion: 1,
    });
  }
  const livestock = careerTwo.endorsements.livestock_handling;

  test("names a regional carrier, an Alaska city and a Yukon delivery", () => {
    const snapshot = snapshotOf({
      created_line: "2.0",
      business_status: "company_driver",
      carrier_key: "chatanika_freight",
      current_city: "fairbanks_ak_us",
      achievement_stats: { cities_delivered: ["anchorage_ak_us", "whitehorse_yt_ca"] },
    });
    expect(snapshot.carrierName).toBe("Chatanika Freight Lines");
    expect(snapshot.businessIdentity).toBe("Company driver for Chatanika Freight Lines");
    expect(snapshot.lastSavedCity).toBe(careerTwo.cityLabels.fairbanks_ak_us);
    expect(snapshot.visitedPlaces?.map((place) => place.state)).toHaveLength(2);
  });

  test("names the towns the missing roads pass added", () => {
    const snapshot = snapshotOf({
      created_line: "2.0",
      current_city: "sikeston_mo_us",
      achievement_stats: { cities_delivered: ["cape_may_nj_us", "galveston_tx_us", "joliet_il_us"] },
    });
    expect(snapshot.lastSavedCity).toBe("Sikeston, Missouri");
    expect(snapshot.visitedPlaces).toEqual([
      { state: "Illinois", cities: ["Joliet"] },
      { state: "New Jersey", cities: ["Cape May"] },
      { state: "Texas", cities: ["Galveston"] },
    ]);
  });

  test("a company driver with no carrier near home shows no carrier", () => {
    const snapshot = snapshotOf({
      created_line: "2.0", business_status: "company_driver", carrier_key: "", carrier_name: "",
    });
    expect(snapshot.carrierName).toBeUndefined();
    expect(snapshot.businessIdentity).toBe("Company driver");
  });

  test("lists the 2.0 credentials only on a 2.0 career", () => {
    const xp = { xp: invariants.levelXp[livestock.level - 1], total_miles: 400_000, deliveries: 400 };
    expect(snapshotOf({ created_line: "2.0" }, xp).endorsements).toContain(livestock.label);
    expect(snapshotOf({ created_line: "1.9" }, xp).endorsements).not.toContain(livestock.label);
    expect(snapshotOf({}, xp).endorsements).not.toContain(livestock.label);
  });
});
