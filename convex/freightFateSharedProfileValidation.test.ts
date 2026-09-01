import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import invariants from "../data/freight-fate-profile-invariants.json";
import { signSharedProfile } from "./freightFateSharedProfileSigning";
import { freightFateSaveSlotName } from "../lib/freight-fate-save-name";
import {
  REQUIRED_FIELDS,
  canonicalSharedProfile,
  knownBadgeCount,
  validateSharedProfile,
} from "./freightFateSharedProfileValidation";

function validProfile() {
  return {
    version: invariants.sourceSaveVersion,
    name: "Road Star",
    money: 9_000,
    current_city: "chicago_il_us",
    // Condition lives per owned truck now, not flat on the profile.
    truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4 } },
    calendar_offset_days: 0,
    migration_notice_pending: false,
    integrity_modified: false,
    integrity_notice_pending: false,
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
    ["no city at all", { current_city: "" }, "invalid_city"],
    // Wear lives per truck now, so the range check has to reach inside the
    // record rather than reading a flat field off the profile.
    [
      "out-of-range wear on an owned truck",
      { truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 101, grime_pct: 4 } } },
      "invalid_range",
    ],
    // A condition record carrying an unknown field is TOLERATED, not
    // rejected -- it is another build line's honest work (see the tolerance
    // stanza below), so dev's old invalid_range case for it is gone.
    ["no truck at all", { truck: "" }, "invalid_possession"],
    ["duplicate owned truck", { owned_trucks: ["rig", "rig"] }, "invalid_possession"],
    ["an upgrade tier no upgrade could reach", { upgrades: { chrome: 500 } }, "invalid_possession"],
  ])("rejects %s", (_label, override, reason) => {
    expect(validateSharedProfile({ ...validProfile(), ...override }, "Road Star"))
      .toMatchObject({ ok: false, reason });
  });

  test.each([
    // Unknown fields are another build line's honest work, not a defect:
    // the allow-lists are exported from one tree while three lines upload
    // (owner-approved tolerance, 2026-08-14; issue #97's lesson). Checks
    // read only the fields they name, so an extra key can reach nothing.
    ["an unknown top-level field", { debug_money: 99 }],
    [
      "a condition record carrying an unknown field",
      { truck_conditions: { rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4, xp: 1 } } },
    ],
  ])("tolerates %s", (_label, override) => {
    expect(validateSharedProfile({ ...validProfile(), ...override }, "Road Star"))
      .toMatchObject({ ok: true });
  });

  test("accepts a career whose unique-value stats outgrew the old 256 cap", () => {
    // achievement_stats holds add_unique_stat sets that only ever grow and
    // are never trimmed. The radio badge needs 25 stations; the list keeps
    // every one. Darren's career reached 256 and every backup after that was
    // refused as invalid_schema -- a permanent lockout that read like a
    // corrupt save. cities_delivered is the same shape against 623 cities.
    expect(validateSharedProfile({
      ...validProfile(),
      achievement_stats: {
        radio_stations_heard: Array.from({ length: 700 }, (_, i) => `station_${i}`),
        cities_delivered: Object.keys(invariants.cityLabels),
      },
    }, "Road Star")).toMatchObject({ ok: true });
  });

  test("still refuses a payload shaped to cost more work than a career can", () => {
    // The shape guard survives as a work budget: nesting past the depth limit
    // is refused, so dropping the per-collection counts did not open the door
    // to a small payload that walks forever.
    let deep: unknown = 1;
    for (let i = 0; i < 20; i += 1) deep = [deep];
    expect(validateSharedProfile({ ...validProfile(), duty_log: deep }, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_schema" });
  });

  test("accepts a 1.9 company driver who owns no tractor", () => {
    // 1.9 rewrote ownership: dispatch hands a company driver a carrier
    // tractor from the level-band fleet, so a fresh career carries an empty
    // owned_trucks list and wear records for trucks it never owned. The old
    // rule demanded everyone own the trainer rig, which silently rejected
    // every backup the 1.9 test builds uploaded.
    expect(validateSharedProfile({
      ...validProfile(),
      business_status: "company_driver",
      owned_trucks: [],
      truck: "ridgeline_sleeper",
      truck_conditions: {
        rig: { fuel_gal: 125, damage_pct: 2, tire_wear_pct: 3, grime_pct: 4 },
        ridgeline_sleeper: { fuel_gal: 80, damage_pct: 1, tire_wear_pct: 2, grime_pct: 9 },
      },
    }, "Road Star")).toMatchObject({ ok: true });
  });

  test("accepts a 1.9 owner-operator who bought out the assigned tractor", () => {
    // The buy-in keeps the tractor dispatch assigned, not the trainer rig,
    // so owned_trucks need not contain "rig" and the active truck rides in
    // whatever the driver actually bought.
    expect(validateSharedProfile({
      ...validProfile(),
      business_status: "leased_owner_operator",
      owned_trucks: ["ridgeline_sleeper"],
      truck: "ridgeline_sleeper",
      truck_conditions: {
        ridgeline_sleeper: { fuel_gal: 80, damage_pct: 1, tire_wear_pct: 2, grime_pct: 9 },
      },
    }, "Road Star")).toMatchObject({ ok: true });
  });

  // Freight Fate 1.9 makes going under water ordinary: a repair bill or a fine
  // a settlement could not cover leaves money negative, and models/solvency.py
  // treats that overdraft as a career state with its own repossession ladder
  // rather than an error. A floor of zero refused every backup from the moment
  // a driver went a cent into the red, and refused it silently -- a
  // schema-family rejection is not retained and consumes no rate-limit row, so
  // the careers this hid left no server-side trace at all. The ceiling below
  // is the check that actually catches invented money; a lower bound caught
  // nothing, because holding less is not a cheat.
  test("accepts a career that is in debt", () => {
    for (const money of [-0.01, -2_200, -50_000]) {
      expect(validateSharedProfile({ ...validProfile(), money }, "Road Star"))
        .toMatchObject({ ok: true });
    }
  });

  test("rejects money and XP that the recorded career cannot support", () => {
    expect(validateSharedProfile({ ...validProfile(), money: 1_000_000 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "impossible_money" });
    expect(validateSharedProfile({
      ...validProfile(),
      career: { ...validProfile().career, xp: 50_000 },
    }, "Road Star")).toMatchObject({ ok: false, reason: "impossible_xp" });
  });

  test("credits the richest career start, not the company-driver default", () => {
    // The owner-operator start opens with 18,000 dollars against near-zero
    // earnings. A ceiling built on the 5,000-dollar company start rejected
    // every honest fresh owner-operator backup as impossible_money
    // (munchkinbear's Little Bear, 2026-08-14). One delivery in, the money
    // is starting cash plus a settlement minus fuel -- entirely honest.
    const fresh = validProfile();
    expect(validateSharedProfile({
      ...fresh,
      money: 18_561.81,
      start_mode: "owner_operator",
      business_status: "leased_owner_operator",
      career: { ...fresh.career, deliveries: 1, on_time_deliveries: 1, total_miles: 125, total_earnings: 673.92, xp: 402.5 },
    }, "Road Star")).toMatchObject({ ok: true });
  });


  test("accepts the 1.9 created-on line marker without demanding it", () => {
    // 1.9 careers stamp the release line they were created on into every
    // save (Freight Fate's created_line field, part of its cutover gate on
    // careers from earlier lines). The allow-list must accept it before any
    // 1.9 build ships, or every 1.9 backup fails the schema check -- but it
    // is never required: every save older builds write predates the marker.
    expect(validateSharedProfile(
      { ...validProfile(), created_line: "1.9" },
      "Road Star",
    )).toMatchObject({ ok: true });
    expect(REQUIRED_FIELDS).not.toContain("created_line");
  });

  test("accepts the 1.9 public-career fields without demanding them", () => {
    // The public profile projection reads the employment status off the top
    // level and self-paid endorsement courses out of the career, so both ride
    // the allow-lists ahead of any 1.9 build shipping — same precedent as
    // created_line, and same rule: never required, because every save older
    // builds write predates the whole 1.9 career arc.
    expect(validateSharedProfile({
      ...validProfile(),
      business_status: "company_driver",
      career: { ...validProfile().career, purchased_endorsements: ["high_value"] },
    }, "Road Star")).toMatchObject({ ok: true });
    expect(REQUIRED_FIELDS).not.toContain("business_status");
  });

  test("accepts the credential-ladder career fields without demanding them", () => {
    // The 2026-08 credential ladder adds two career fields: courses waiting
    // on their background check, and grants queued for a terminal repeat.
    // Both ride the exported allow-list; neither is required, because every
    // save written before the ladder predates them.
    expect(validateSharedProfile({
      ...validProfile(),
      career: {
        ...validProfile().career,
        purchased_endorsements: ["doubles_triples"],
        pending_credentials: [{ key: "hazmat", ready_at_h: 4321.5 }],
        unacknowledged_grants: ["doubles_triples"],
      },
    }, "Road Star")).toMatchObject({ ok: true });
    expect(validateSharedProfile(validProfile(), "Road Star")).toMatchObject({ ok: true });
  });

  test("accepts bounded optional facts used by the richer public projection", () => {
    expect(validateSharedProfile({
      ...validProfile(),
      business_status: "company_driver",
      carrier_key: "northstar",
      owned_trailers: [],
      driving_record: {
        serious_violations: [20, 40], major_offenses: [80], citations: 3,
        fines_paid: 1_250, fatigue_events: 1, trust_band_heard: "probation",
        debt_rung_heard: 0, repossessions: 0, setback_notice_kind: "",
        setback_notice_lines: [], suspended_until_h: 0, suspension_reason: "",
        lifetime_disqualified: false, carrier_terminations: 1, notice_pending: false,
      },
      achievement_stats: {
        damage_free_deliveries: 9,
        longest_haul_miles: 875.4,
        cities_delivered: ["chicago_il_us", "denver_co_us"],
        cargo_claims: 1,
        preventable_equipment_damage: 2,
        "hint:engine_start:Press E:auto": 3,
      },
    }, "Road Star")).toMatchObject({ ok: true });
  });

  test("accepts future trailer IDs for backup while publication filters them", () => {
    for (const trailer of [
      "dry_van", "reefer", "flatbed", "bulk", "tank", "double_van",
    ]) {
      expect(validateSharedProfile({
        ...validProfile(),
        owned_trailers: [trailer],
      }, "Road Star")).toMatchObject({ ok: true });
    }
    for (const trailer of ["invented_trailer", "toString"]) {
      expect(validateSharedProfile({
        ...validProfile(),
        owned_trailers: [trailer],
      }, "Road Star")).toMatchObject({ ok: true });
    }
  });

  test("accepts verified city coverage beyond the old generic array cap", () => {
    const profile = validProfile();
    profile.career.deliveries = 257;
    profile.achievement_stats = {
      cities_delivered: Object.keys(invariants.cityLabels).slice(0, 257),
    };
    expect(validateSharedProfile(profile, "Road Star")).toMatchObject({ ok: true });
  });

  test.each([
    ["fractional damage-free count", { damage_free_deliveries: 1.5 }],
    ["damage-free count above deliveries", { damage_free_deliveries: 13 }],
    ["longest haul above lifetime miles", { longest_haul_miles: 4_101 }],
    ["duplicate visited city", { cities_delivered: ["chicago_il_us", "chicago_il_us"] }],
    ["negative cargo claim count", { cargo_claims: -1 }],
    ["fractional damage incident count", { preventable_equipment_damage: 0.5 }],
  ])("rejects an unverified richer-profile counter: %s", (_label, achievementStats) => {
    expect(validateSharedProfile({
      ...validProfile(),
      achievement_stats: achievementStats,
    }, "Road Star")).toMatchObject({ ok: false, reason: "invalid_achievement" });
  });

  test("rejects malformed safety facts before they can enter a public snapshot", () => {
    expect(validateSharedProfile({
      ...validProfile(),
      driving_record: {
        serious_violations: [], major_offenses: [], citations: -1,
        fines_paid: 0, fatigue_events: 0, repossessions: 0, carrier_terminations: 0,
      },
    }, "Road Star")).toMatchObject({ ok: false, reason: "invalid_range" });
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

  test("rejects a market with no multipliers or a rewritten band", () => {
    const empty = validProfile();
    empty.market.multipliers = {};
    expect(validateSharedProfile(empty, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_market" });
    const rigged = validProfile();
    rigged.market.multipliers = { general: 9 };
    expect(validateSharedProfile(rigged, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_market" });
  });

  test("rejects an unsupported save version", () => {
    expect(validateSharedProfile({ ...validProfile(), version: 99 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
  });

  // Content this server has not been told about is a newer game, not a forged
  // career: the game ships cities, tractors, cargo classes, and badges on its
  // own cadence while these lists come from one exported tree. Refusing on
  // membership meant a content change and a validator deploy had to land the
  // same day or honest drivers lost Cloud Backup -- which is what `first_day`
  // did to jessie and Tim on 2026-08-14, on a badge earned in the first
  // shift. Accepted here, and filtered where it would otherwise be published.
  test.each([
    ["a city the export has not caught up to", { current_city: "moon_base_mo_us" }],
    ["a tractor added after this export", { truck: "warp_drive" }],
    ["an owned tractor added after this export", { owned_trucks: ["rig", "warp_drive"] }],
    ["an upgrade this export has never seen", { upgrades: { warp_core: 3 } }],
    ["a badge awarded by a newer build", { achievements: ["invented"] }],
  ])("accepts %s", (_label, override) => {
    expect(validateSharedProfile({ ...validProfile(), ...override }, "Road Star"))
      .toMatchObject({ ok: true });
  });

  test("a cargo class added after this export is a market, not a forgery", () => {
    const profile = validProfile();
    profile.market.multipliers = { ...profile.market.multipliers, antigravity: 1.1 };
    expect(validateSharedProfile(profile, "Road Star")).toMatchObject({ ok: true });
  });

  test("the public badge tally counts only badges this server can name", () => {
    // Membership became a publishing question rather than an acceptance one,
    // so the filtering has to happen somewhere: the tally and the catalog it
    // is shown against must describe the same set, or a newer game inflates
    // the number on a public profile.
    expect(knownBadgeCount([invariants.achievementIds[0], "invented"])).toBe(1);
    expect(knownBadgeCount(["invented"])).toBe(0);
    expect(knownBadgeCount("not a list")).toBe(0);
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

describe("field list stays in step with the game", () => {
  test("the validator's allow-lists come from the exported invariants", () => {
    // These were hand-written here once and fell behind the game: the profile
    // moved condition into truck_conditions and gained calendar_offset_days,
    // so every upload from a current build was rejected as both unknown and
    // incomplete. Reading them from the export is what stops that recurring.
    expect(invariants.profileFields).toContain("truck_conditions");
    expect(invariants.profileFields).toContain("calendar_offset_days");
    expect(invariants.profileFields).toContain("integrity_modified");
    expect(invariants.profileFields).not.toContain("_signature");
    expect(invariants.profileFields).not.toContain("truck_damage_pct");
    expect(invariants.careerFields).toContain("total_earnings");
  });

  test("a profile carrying the modified mark still validates", () => {
    // The mark is advisory: copying a career to another computer raises it
    // honestly. The gate must judge the numbers, not the flag.
    const marked = { ...validProfile(), integrity_modified: true, integrity_notice_pending: true };
    expect(validateSharedProfile(marked, "Road Star")).toMatchObject({ ok: true });
  });
});

// Every profile shape that has actually shipped, taken from the game's own
// tags rather than guessed. Four of the five were rejected in production at
// some point, because the validator demanded an exact match with whichever
// single build the invariants export had last been generated from. Save
// version alone does not pin the field set -- two version 4 shapes and two
// version 5 shapes went out -- so each one is pinned here by name.
function stableProfile() {
  // v1.8.1, v1.8.3 (current stable), nightly-20260717: flat condition,
  // no calendar offset, no notice flags.
  const {
    truck_conditions: _conditions,
    calendar_offset_days: _offset,
    migration_notice_pending: _migration,
    integrity_modified: _modified,
    integrity_notice_pending: _notice,
    ...rest
  } = validProfile();
  return {
    ...rest,
    version: 4,
    truck_fuel_gal: 125,
    truck_damage_pct: 2,
    tire_wear_pct: 3,
    road_grime_pct: 4,
  };
}

function calendarNightlyProfile() {
  // nightly-20260718: still version 4, but calendar_offset_days had landed.
  // This is the shape in issue #97 -- rejected as an unknown field.
  return { ...stableProfile(), calendar_offset_days: 0 };
}

function firstPerTruckNightlyProfile() {
  // nightly-20260719: version 5 arrived before the integrity flags did.
  const { integrity_modified: _modified, integrity_notice_pending: _notice, ...rest } =
    validProfile();
  return rest;
}

describe("every shipped profile shape still backs up", () => {
  test.each([
    ["v1.8.3, the current stable release", stableProfile],
    ["nightly-20260718, version 4 plus the calendar offset", calendarNightlyProfile],
    ["nightly-20260719, version 5 before the integrity flags", firstPerTruckNightlyProfile],
    ["the current build", validProfile],
  ])("accepts %s", (_label, build) => {
    expect(validateSharedProfile(build(), "Road Star")).toMatchObject({ ok: true });
  });

  test("tolerates an unrecognized field on an older shape too", () => {
    // Same cross-line tolerance as current shapes: a stable-line save with a
    // field this export never saw is another build's honest work, and no
    // check can read it. Ranges and required fields on the older shape stay
    // as strict as ever (see the version 4 test below).
    expect(validateSharedProfile({ ...stableProfile(), debug_money: 99 }, "Road Star"))
      .toMatchObject({ ok: true });
  });

  test("holds a version 4 profile to the same condition ranges", () => {
    expect(validateSharedProfile({ ...stableProfile(), tire_wear_pct: 101 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_range" });
    const { road_grime_pct: _missing, ...incomplete } = stableProfile();
    expect(validateSharedProfile(incomplete, "Road Star"))
      .toMatchObject({ ok: false, reason: "invalid_range" });
  });

  test("names version skew as version skew, not a malformed backup", () => {
    // A save from a build this server has never seen has to say so. Failing
    // the field check underneath instead tells the player their career is
    // broken, which is what issue #97 heard for what was only an old build.
    expect(validateSharedProfile({ ...validProfile(), version: 99 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(validateSharedProfile({ ...stableProfile(), version: 3 }, "Road Star"))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
  });

  test("requires only fields the game still writes and the checks still read", () => {
    // The drift guard. Anything demanded here has to exist in the game's
    // current export, or the next build's saves are rejected as incomplete.
    for (const field of REQUIRED_FIELDS) {
      expect(invariants.profileFields).toContain(field);
    }
    expect(REQUIRED_FIELDS).not.toContain("truck_conditions");
    expect(REQUIRED_FIELDS).not.toContain("integrity_modified");
  });
});

describe("per-truck condition fields track the game", () => {
  test("the condition allow-list is exported, not hand-kept", () => {
    // The 1.9 line adds brake_wear_pct, engine_wear_pct and traction gear to
    // this record. A list written out here would reject those saves on the
    // day they ship -- the same drift that broke cloud backup once already.
    expect(invariants.truckConditionFields).toContain("fuel_gal");
    expect(invariants.truckConditionFields).toContain("tire_wear_pct");
    expect(invariants.truckConditionFields.length).toBeGreaterThan(0);
  });
});

describe("cross-line field tolerance (issue #97, relearned 2026-08-14)", () => {
  test("a payload carrying fields from another build line still validates", () => {
    const profile = validProfile();
    (profile as Record<string, unknown>).dev_line_novel_field = 3;
    (profile.career as Record<string, unknown>).dev_line_novel_counter = 7;
    expect(validateSharedProfile(profile, "Road Star")).toMatchObject({ ok: true });
  });

  test("missing required fields still refuse", () => {
    const profile = validProfile();
    delete (profile as Record<string, unknown>).career;
    expect(validateSharedProfile(profile, "Road Star")).toMatchObject({ ok: false });
  });
});
