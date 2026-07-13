import { gunzipSync } from "node:zlib";

// Server-side tamper screening for uploaded Freight Fate save blobs.
//
// Local saves can never be made truly uneditable — the game is a local,
// open-source program, so the player's machine always has the last word.
// What CAN be enforced is arithmetic: every dollar in an honest career comes
// from delivery settlements (mirrored one-for-one into career.total_earnings)
// or a pay advance capped at 1,500, and experience is bounded by miles
// driven. An edited save either breaks those invariants or has been made
// plausible — in which case it can no longer distort the public boards.
//
// The route runs this before storing an upload and the verdict is stamped on
// the driver row for moderation. Nothing here blocks the upload: cloud
// backup keeps working for the player; the flag is moderation data.
//
// Mirrors tools/save_forensics.py in the Freight-fate repo — keep the two in
// step when economy rules change.

// From src/freight_fate/models: STARTING_MONEY, PAY_ADVANCE_LIMIT, and the
// truck/upgrade catalogs. Constants are duplicated here because the server
// cannot import the game; both sides carry a pointer to the other.
const STARTING_MONEY = 5_000;
const PAY_ADVANCE_LIMIT = 1_500;
const TRUCK_PRICES: Record<string, number> = { rig: 0, heavy_hauler: 52_000 };
const UPGRADE_PRICES: Record<string, number[]> = {
  engine_tune: [12_000, 26_000],
  aero_kit: [9_000],
  long_range_tank: [7_500],
  reinforced_brakes: [6_500],
};
// On-time deliveries earn miles * 1.2 XP on save-version-4 rules. Later save
// versions add cargo-class and streak multipliers, so the XP invariant is
// only enforced on versions this screen knows.
const XP_PER_MILE_V4 = 1.2;
const XP_RULE_MAX_VERSION = 4;
const EPSILON = 1;

export type SaveIntegrity =
  | "ok"
  | "unreadable" // not gzip/JSON — corrupt or not a profile at all
  | "unsigned" // the game always signs; a missing signature means hand editing
  | "impossible_money" // money exceeds every legitimate source
  | "impossible_xp"; // XP exceeds the per-mile ceiling for its save version

// The uploaded blob is gzipped profile JSON, exactly as the game wrote it.
export function screenSaveBlob(content: ArrayBuffer): SaveIntegrity {
  let profile: Record<string, unknown>;

  try {
    const bytes = new Uint8Array(content);
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    profile = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    return "unreadable";
  }

  if (typeof profile !== "object" || profile === null || !profile.career) {
    return "unreadable";
  }

  const career = profile.career as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const money = num(profile.money);
  const earnings = num(career.total_earnings);
  const advance = Math.min(Math.max(0, num(profile.pay_advance)), PAY_ADVANCE_LIMIT);
  const version = num(profile.version);

  if (version >= 4 && typeof profile._signature !== "string") {
    return "unsigned";
  }

  let gearSpend = 0;
  for (const key of Array.isArray(profile.owned_trucks) ? profile.owned_trucks : []) {
    gearSpend += TRUCK_PRICES[key as string] ?? 0;
  }
  const upgrades = (profile.upgrades ?? {}) as Record<string, unknown>;
  for (const [key, tier] of Object.entries(upgrades)) {
    for (const price of (UPGRADE_PRICES[key] ?? []).slice(0, Math.max(0, num(tier)))) {
      gearSpend += price;
    }
  }

  if (money + gearSpend > STARTING_MONEY + earnings + advance + EPSILON) {
    return "impossible_money";
  }

  if (version <= XP_RULE_MAX_VERSION) {
    const xp = num(career.xp);
    const miles = num(career.total_miles);
    if (xp > miles * XP_PER_MILE_V4 + EPSILON) {
      return "impossible_xp";
    }
  }

  return "ok";
}
