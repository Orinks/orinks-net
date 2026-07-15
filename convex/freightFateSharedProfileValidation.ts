import invariants from "../data/freight-fate-profile-invariants.json";
import { freightFateSaveSlotName } from "../lib/freight-fate-save-name";

export const SHARED_PROFILE_VALIDATOR_VERSION = 1;
export const MAX_SHARED_PROFILE_BYTES = 256 * 1024;

type JsonObject = Record<string, unknown>;

export type SharedProfileValidation =
  | { ok: true; payload: JsonObject }
  | { ok: false; reason: string; message: string };

const TOP_LEVEL_FIELDS = new Set([
  "version", "name", "money", "current_city", "truck_damage_pct", "tire_wear_pct",
  "road_grime_pct", "truck_fuel_gal", "game_hours", "tutorial_done", "truck",
  "owned_trucks", "upgrades", "active_trip", "dispatch_board_cache", "fatigue",
  "pay_advance", "pay_advance_used_for_load", "career", "market", "hos",
  "achievements", "achievement_stats",
]);
const REQUIRED_FIELDS = [...TOP_LEVEL_FIELDS];
const CAREER_FIELDS = new Set([
  "xp", "reputation", "deliveries", "on_time_deliveries", "total_miles", "total_earnings",
]);
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
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 4096;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 256 && value.every((item) => safeJson(item, depth + 1));
  }
  const record = object(value);
  if (!record) return false;
  const entries = Object.entries(record);
  return entries.length <= 128 && entries.every(
    ([key, item]) => key.length <= 128 && safeJson(item, depth + 1),
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
  if (!exactFields(payload, TOP_LEVEL_FIELDS)
    || REQUIRED_FIELDS.some((field) => !(field in payload))) {
    return failure("invalid_schema", "The cloud backup has missing or unknown profile fields.");
  }
  if (payload.version !== invariants.sourceSaveVersion) {
    return failure("unsupported_version", "This career version is not supported for Cloud Backup.");
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
  for (const key of ["truck_damage_pct", "tire_wear_pct", "road_grime_pct", "fatigue"]) {
    if (!finite(payload[key], 0, 100)) return failure("invalid_range", `${key} is outside its allowed range.`);
  }
  if (!finite(payload.money, 0, 100_000_000)
    || !finite(payload.truck_fuel_gal, 0, 500)
    || !finite(payload.game_hours, 0, 10_000_000)
    || !finite(payload.pay_advance, 0, 1_500)
    || typeof payload.tutorial_done !== "boolean"
    || typeof payload.pay_advance_used_for_load !== "boolean") {
    return failure("invalid_range", "The cloud backup has a value outside its allowed range.");
  }

  const truck = typeof payload.truck === "string" ? payload.truck : "";
  const owned = Array.isArray(payload.owned_trucks) ? payload.owned_trucks : [];
  if (!(truck in TRUCK_PRICES) || owned.length === 0 || owned.length > Object.keys(TRUCK_PRICES).length
    || !owned.every((key) => typeof key === "string" && key in TRUCK_PRICES)
    || new Set(owned).size !== owned.length || !owned.includes("rig") || !owned.includes(truck)) {
    return failure("invalid_possession", "The cloud backup has an unknown or unowned truck.");
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
  if ((career.xp as number) > (career.total_miles as number) * 1.2 + 1) {
    return failure("impossible_xp", "The cloud backup experience is not supported by its recorded miles.");
  }
  let gearSpend = owned.reduce((sum, key) => sum + TRUCK_PRICES[key as string], 0);
  for (const [key, tier] of Object.entries(upgrades)) {
    gearSpend += UPGRADE_PRICES[key].slice(0, tier as number).reduce((sum, price) => sum + price, 0);
  }
  if ((payload.money as number) + gearSpend
    > 5_000 + (career.total_earnings as number) + (payload.pay_advance as number) + 1) {
    return failure("impossible_money", "The cloud backup money and equipment exceed its recorded earnings.");
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
