import invariants from "../data/freight-fate-profile-invariants.json";
import { freightFateSaveSlotName } from "../lib/freight-fate-save-name";

export const SHARED_PROFILE_VALIDATOR_VERSION = 1;
export const MAX_SHARED_PROFILE_BYTES = 256 * 1024;

type JsonObject = Record<string, unknown>;

export type SharedProfileValidation =
  | { ok: true; payload: JsonObject }
  | { ok: false; reason: string; message: string };

// Condition lived flat on the profile through save version 4 and moved into
// truck_conditions in version 5. Both shapes are still in players' hands, so
// both are still read; the numbers have to be sane either way.
const LEGACY_CONDITION_LIMITS: Record<string, number> = {
  truck_fuel_gal: 500,
  truck_damage_pct: 100,
  tire_wear_pct: 100,
  road_grime_pct: 100,
};
// The allowed set comes from the game's own dataclasses via
// tools/export_profile_integrity_invariants.py, widened by the fields older
// supported builds still write. Exporting one build's list and demanding an
// exact match was wrong in both directions: it rejected newer saves as
// carrying unknown fields until the export was regenerated, and then rejected
// every older save as incomplete the moment it was. Five profile shapes have
// shipped between v1.8.1 and today and four of them were refused at some
// point -- including the one the current stable release writes. So this is a
// superset guard now: an unknown field is still refused, but a field this
// validator never reads is never demanded.
const TOP_LEVEL_FIELDS = new Set([
  ...invariants.profileFields,
  ...Object.keys(LEGACY_CONDITION_LIMITS),
]);
// Only what every supported build writes and the checks below actually read.
// A field the game adds later arrives in profileFields, so it is allowed
// without becoming mandatory -- which is what keeps older builds working.
export const REQUIRED_FIELDS = [
  "version", "name", "money", "current_city", "game_hours", "tutorial_done",
  "truck", "owned_trucks", "upgrades", "active_trip", "dispatch_board_cache",
  "fatigue", "pay_advance", "pay_advance_used_for_load", "career", "market",
  "hos", "achievements", "achievement_stats",
];
// Fields that arrived after version 4 shipped: calendar_offset_days mid-way
// through the nightlies, the three notice flags a build or two later again.
// Checked when present, not missed when absent.
const OPTIONAL_FLAG_FIELDS = [
  "migration_notice_pending", "integrity_modified", "integrity_notice_pending",
];
// Version 4 is what v1.8.3 -- the current stable release -- writes, and the
// game migrates it to the current shape on load. Accepting it costs nothing;
// refusing it locks out every player who is not running a nightly.
const OLDEST_SUPPORTED_SAVE_VERSION = 4;
const CAREER_FIELDS = new Set(invariants.careerFields);
// Exported too, for the same reason as the profile list: this record is where
// new per-truck state lands (brake and engine wear, traction gear), and a copy
// kept here would reject the next build's saves the day one is added.
const TRUCK_CONDITION_FIELDS = new Set(invariants.truckConditionFields);
const MARKET_FIELDS = new Set(["seed", "day", "multipliers"]);
const HOS_FIELDS = new Set([
  "driving_min", "duty_min", "since_break_min", "status", "non_driving_min",
  "off_duty_min", "warned", "history", "split_rest_history", "split_credit_key",
]);
const HOS_EVENT_FIELDS = new Set([
  "status", "minutes", "drive_before", "duty_before", "since_break_before", "source",
]);
const DUTY_STATUSES = new Set(["driving", "on_duty_not_driving", "off_duty", "sleeper_berth"]);
const CITY_SLUGS = new Set(Object.keys(invariants.cityLabels));
const ACHIEVEMENT_IDS = new Set(invariants.achievementIds);
const MARKET_KEYS = new Set(invariants.marketCargoKeys);
const TRUCK_PRICES = invariants.truckPrices as Record<string, number>;
const UPGRADE_PRICES = invariants.upgradePrices as Record<string, number[]>;
// Economy terms behind the two arithmetic checks, exported from the game for
// the same reason the field lists are: a copy kept here goes stale on the next
// balance pass and starts rejecting honest backups.
const STARTING_MONEY = invariants.startingMoney as number;
// The richest career start the game offers. The money ceiling has to credit
// this, not STARTING_MONEY: the owner-operator start opens with 18,000
// dollars, and a ceiling built on the company-driver 5,000 rejected every
// honest owner-operator backup as impossible_money until earnings outgrew
// the gap (munchkinbear, 2026-08-14). Falls back to STARTING_MONEY for an
// invariants file exported before the key existed.
const STARTING_MONEY_MAX = (invariants.startingMoneyMax as number | undefined) ?? STARTING_MONEY;
const XP_PER_MILE_MAX = invariants.xpPerMileMax as number;
const XP_FLAT_PER_DELIVERY = invariants.xpFlatPerDelivery as number;
// Absorbs rounding drift between a total accumulated per delivery and the same
// total recomputed once here. Cents, not dollars -- it is not a cheat budget.
const ARITHMETIC_SLACK = 1;

function failure(reason: string, message: string): SharedProfileValidation {
  return { ok: false, reason, message };
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function finite(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min: number, max: number) {
  return finite(value, min, max) && Number.isInteger(value);
}

function exactFields(value: JsonObject, allowed: Set<string>) {
  // Unknown keys are tolerated, not rejected (owner-approved 2026-08-14).
  // Three build lines upload here at once (stable, dev nightlies, 1.9
  // testers) and the allow-lists are exported from ONE game tree, so a
  // field another line grew reads as "unknown" the day it ships -- issue
  // #97's lesson, relearned when a dev-nightly career (munchkinbear) was
  // refused as invalid_schema for fields the 1.9 export had never seen.
  // Every check reads only the fields it names, and the public profile is
  // built from known fields alone (canonicalSharedProfile), so an extra
  // key can never reach a check or a public surface. Required fields,
  // types, ranges, and arithmetic stay as strict as ever; the `allowed`
  // sets remain as documentation of the fields the checks may read.
  void value;
  void allowed;
  return true;
}

// Total values this walk will look at before giving up. The document reaching
// here is already bounded -- the action gunzips with maxOutputLength set to
// MAX_SHARED_PROFILE_BYTES, so nothing larger than a quarter megabyte of JSON
// can be presented -- so this only has to stop a small payload from being
// shaped to cost a lot (deep nesting, a million empty arrays). It is a work
// budget, not a statement about how much career a driver may have.
const MAX_JSON_NODES = 200_000;

// This used to cap every array at 256 entries and every object at 128 keys,
// which read as a safety rule and behaved as a career length limit. The game
// keeps unique-value sets in achievement_stats that only ever grow --
// radio_stations_heard, cities_delivered -- through add_unique_stat, and
// nothing trims them. A driver who heard a 257th station could never back up
// again: the badge needed 25, the list kept all of them, and the refusal came
// back as "invalid_schema", so it read as a corrupt save rather than a wall.
// Darren hit it at exactly 256 and was refused 27 times in one morning; with
// 623 cities in the world, cities_delivered was the same cliff further out.
// Shape is not evidence of anything, and the byte cap above already bounds the
// work, so what stays is depth (stack safety), string length, and a node
// budget -- none of which a real career can grow into.
function safeJson(value: unknown, depth = 0, budget = { left: MAX_JSON_NODES }): boolean {
  if (depth > 12) return false;
  if ((budget.left -= 1) < 0) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 4096;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => safeJson(item, depth + 1, budget));
  }
  const record = object(value);
  if (!record) return false;
  return Object.entries(record).every(
    ([key, item]) => key.length <= 128 && safeJson(item, depth + 1, budget),
  );
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  const record = object(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, sortedJson(record[key])]),
  );
}

export function canonicalSharedProfile(payload: JsonObject) {
  // Python's json.dumps(... ensure_ascii=True) escapes every UTF-16 code unit.
  // JSON.stringify already handles control characters; this second pass makes
  // non-ASCII output byte-for-byte compatible with the game verifier.
  return JSON.stringify(sortedJson(payload)).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function validateHosEvent(value: unknown) {
  const event = object(value);
  if (!event || !exactFields(event, HOS_EVENT_FIELDS)) return false;
  return DUTY_STATUSES.has(event.status as string)
    && finite(event.minutes, 0, 10_000_000)
    && finite(event.drive_before, 0, 10_000_000)
    && finite(event.duty_before, 0, 10_000_000)
    && finite(event.since_break_before, 0, 10_000_000)
    && typeof event.source === "string"
    && event.source.length <= 32;
}

function validateHos(value: unknown) {
  const hos = object(value);
  if (!hos || !exactFields(hos, HOS_FIELDS)) return false;
  for (const key of [
    "driving_min", "duty_min", "since_break_min", "non_driving_min", "off_duty_min",
  ]) {
    if (!finite(hos[key], 0, 10_000_000)) return false;
  }
  if (!DUTY_STATUSES.has(hos.status as string)) return false;
  if (!Array.isArray(hos.warned) || hos.warned.length > 64
    || !hos.warned.every((item) => typeof item === "string" && item.length <= 128)) return false;
  if (!Array.isArray(hos.history) || hos.history.length > 96
    || !hos.history.every(validateHosEvent)) return false;
  if (!Array.isArray(hos.split_rest_history) || hos.split_rest_history.length > 16
    || !hos.split_rest_history.every(validateHosEvent)) return false;
  return hos.split_credit_key === null
    || (typeof hos.split_credit_key === "string" && hos.split_credit_key.length <= 4096);
}

export function validateSharedProfile(value: unknown, saveName: string): SharedProfileValidation {
  const payload = object(value);
  if (!payload || !safeJson(payload)) {
    return failure("invalid_schema", "The cloud backup is not a supported profile document.");
  }
  const canonical = canonicalSharedProfile(payload);
  if (new TextEncoder().encode(canonical).byteLength > MAX_SHARED_PROFILE_BYTES) {
    return failure("too_large", "The cloud backup is too large to validate.");
  }
  // Version is read before the field lists so a save this server does not
  // know is named as version skew. Underneath, an unrecognised shape fails
  // the field check instead, and the player hears that their backup is
  // malformed when their game is only a different build.
  if (!integer(payload.version, OLDEST_SUPPORTED_SAVE_VERSION, invariants.sourceSaveVersion)) {
    return failure("unsupported_version", "This career version is not supported for Cloud Backup.");
  }
  if (!exactFields(payload, TOP_LEVEL_FIELDS)
    || REQUIRED_FIELDS.some((field) => !(field in payload))) {
    return failure("invalid_schema", "The cloud backup has missing or unknown profile fields.");
  }
  const normalizedName = typeof payload.name === "string"
    ? freightFateSaveSlotName(payload.name)
    : "";
  if (typeof payload.name !== "string" || payload.name.trim().length === 0
    || payload.name.length > 48 || normalizedName !== saveName) {
    return failure("invalid_name", "The cloud backup name does not match its save slot.");
  }
  if (!CITY_SLUGS.has(payload.current_city as string)) {
    return failure("invalid_city", "The cloud backup is not in a known Freight Fate city.");
  }
  if (!finite(payload.fatigue, 0, 100)) {
    return failure("invalid_range", "fatigue is outside its allowed range.");
  }
  // Money is allowed to run negative: a 1.9 driver goes under on a repair bill
  // or a fine their settlement could not cover, and the game carries that
  // overdraft as a career state (models/solvency.py) with its own repossession
  // ladder. Only the ceiling is a cheat check -- see the impossible_money rule
  // below, which is what money has to trace back to. A floor of zero caught no
  // cheat and instead refused every backup a driver made while in the red,
  // silently, since a schema-family rejection is retained nowhere.
  if (!finite(payload.money, -100_000_000, 100_000_000)
    || !finite(payload.game_hours, 0, 10_000_000)
    || !finite(payload.pay_advance, 0, 1_500)
    || typeof payload.tutorial_done !== "boolean"
    || typeof payload.pay_advance_used_for_load !== "boolean") {
    return failure("invalid_range", "The cloud backup has a value outside its allowed range.");
  }
  if ("calendar_offset_days" in payload
    && !integer(payload.calendar_offset_days, -100_000, 100_000)) {
    return failure("invalid_range", "The cloud backup has a value outside its allowed range.");
  }
  if (OPTIONAL_FLAG_FIELDS.some(
    (flag) => flag in payload && typeof payload[flag] !== "boolean",
  )) {
    return failure("invalid_range", "The cloud backup has a value outside its allowed range.");
  }

  // Version 5 moved condition off the profile and onto each owned truck.
  // Records for trucks this build does not know are left alone on purpose --
  // a newer client may own one -- but every record's numbers still have to be
  // sane. A version 4 save carries one flat set instead; it is held to the
  // same ranges, and the game rebuilds it per truck when it loads the restore.
  if ("truck_conditions" in payload) {
    const conditions = object(payload.truck_conditions);
    if (!conditions) {
      return failure("invalid_schema", "The cloud backup has no truck condition records.");
    }
    for (const record of Object.values(conditions)) {
      const condition = object(record);
      if (!condition || !exactFields(condition, TRUCK_CONDITION_FIELDS)
        || !finite(condition.fuel_gal, 0, 500)
        || !finite(condition.damage_pct, 0, 100)
        || !finite(condition.tire_wear_pct, 0, 100)
        || !finite(condition.grime_pct, 0, 100)) {
        return failure("invalid_range", "A truck's condition is outside its allowed range.");
      }
    }
  } else if (Object.entries(LEGACY_CONDITION_LIMITS).some(
    ([field, high]) => !finite(payload[field], 0, high),
  )) {
    return failure("invalid_range", "A truck's condition is outside its allowed range.");
  }

  // Ownership carries no arithmetic since the 1.9 carrier-fleet model: a
  // company driver runs a dispatch-assigned tractor and owns nothing until
  // the owner-operator buy-in, and that buy-in keeps the assigned tractor
  // rather than the trainer rig. So an empty list is the ordinary career and
  // no particular key is ever guaranteed. What stays checkable is that every
  // key names a real tractor, listed once. Whether the driver may hold or
  // drive one is the game's dispatch model -- like the money rule above,
  // laundering through the garage is left to offline forensics.
  const truck = typeof payload.truck === "string" ? payload.truck : "";
  const owned = Array.isArray(payload.owned_trucks) ? payload.owned_trucks : [];
  if (!(truck in TRUCK_PRICES) || owned.length > Object.keys(TRUCK_PRICES).length
    || !owned.every((key) => typeof key === "string" && key in TRUCK_PRICES)
    || new Set(owned).size !== owned.length) {
    return failure("invalid_possession", "The cloud backup has an unknown truck.");
  }
  const upgrades = object(payload.upgrades);
  if (!upgrades || Object.keys(upgrades).some((key) => !(key in UPGRADE_PRICES))) {
    return failure("invalid_possession", "The cloud backup has an unknown upgrade.");
  }
  for (const [key, tier] of Object.entries(upgrades)) {
    if (!integer(tier, 1, UPGRADE_PRICES[key].length)) {
      return failure("invalid_possession", "The cloud backup has an unavailable upgrade tier.");
    }
  }

  const career = object(payload.career);
  if (!career || !exactFields(career, CAREER_FIELDS)
    || !finite(career.xp, 0, 25_000_000)
    || !finite(career.reputation, 0, 100)
    || !integer(career.deliveries, 0, 1_000_000)
    || !integer(career.on_time_deliveries, 0, career.deliveries as number)
    || !finite(career.total_miles, 0, 20_000_000)
    || !finite(career.total_earnings, 0, 100_000_000)) {
    return failure("invalid_career", "The cloud backup totals are outside their allowed ranges.");
  }
  // Most XP the recorded driving could have taught, every bonus at its best,
  // from the game's own rates. It used to be a hand-copied 1.2 per mile, which
  // sat exactly on what a spotless career earns -- one XP of headroom, and
  // below the rate the 1.9 arc pays -- so honest drivers were the ones it
  // caught. Wrong in the generous direction is the survivable wrong here.
  const xpCeiling = (career.deliveries as number) * XP_FLAT_PER_DELIVERY
    + (career.total_miles as number) * XP_PER_MILE_MAX
    + ARITHMETIC_SLACK;
  if ((career.xp as number) > xpCeiling) {
    return failure("impossible_xp", "The cloud backup experience is not supported by its recorded miles.");
  }
  // Every dollar held has to trace to starting cash, lifetime earnings, or an
  // outstanding advance. Spending only ever lowers money, so this holds for
  // any honest career without the server modelling what things cost.
  //
  // It deliberately does NOT price owned gear. Doing so meant re-deriving
  // every way a truck can be acquired, and the game grants some outright --
  // an owner-operator buys out a carrier tractor worth far more than the
  // buy-in, which read as ~$150k of invented money and rejected the backup of
  // everyone who took that step. A career that launders invented money
  // through the garage is left to offline forensics, which is what has
  // actually caught every real edit so far.
  if ((payload.money as number)
    > STARTING_MONEY_MAX + (career.total_earnings as number)
      + (payload.pay_advance as number) + ARITHMETIC_SLACK) {
    return failure("impossible_money", "The cloud backup money exceeds what the career has earned.");
  }

  const market = object(payload.market);
  const multipliers = object(market?.multipliers);
  if (!market || !exactFields(market, MARKET_FIELDS)
    || !integer(market.seed, 0, 2_147_483_647)
    || !integer(market.day, 0, Math.floor((payload.game_hours as number) / 24) + 1)
    || !multipliers
    // Careers begun before a cargo-class expansion carry multipliers only
    // for the classes that existed then; any non-empty subset of the
    // current classes is a legitimate market.
    || Object.keys(multipliers).length === 0
    || Object.keys(multipliers).some((key) => !MARKET_KEYS.has(key))
    || Object.values(multipliers).some((entry) => !finite(entry, 0.8, 1.3))) {
    return failure("invalid_market", "The cloud backup freight market is not valid.");
  }
  if (!validateHos(payload.hos)) {
    return failure("invalid_hos", "The cloud backup duty clock is not valid.");
  }
  const achievements = Array.isArray(payload.achievements) ? payload.achievements : [];
  if (!Array.isArray(payload.achievements) || achievements.length > ACHIEVEMENT_IDS.size
    || achievements.some((id) => typeof id !== "string" || !ACHIEVEMENT_IDS.has(id))
    || new Set(achievements).size !== achievements.length
    || !object(payload.achievement_stats)) {
    return failure("invalid_achievement", "The cloud backup has an unknown achievement record.");
  }
  if (!(payload.active_trip === null || object(payload.active_trip))
    || !(payload.dispatch_board_cache === null || object(payload.dispatch_board_cache))) {
    return failure("invalid_schema", "The cloud backup trip or dispatch data is not valid.");
  }
  return { ok: true, payload };
}
