import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import { maskDisplayName, screenDisplayName } from "./moderation";
import invariants from "../data/freight-fate-profile-invariants.json";

const visibility = v.union(v.literal("public"), v.literal("private"), v.literal("unlisted"));

// A driver whose latest heartbeat is older than this is off the live board.
// Paired with HEARTBEAT_INTERVAL_S in Freight Fate's online_presence.py: this
// has to be more than twice the beat, so one dropped request never blinks a
// live driver off. The beat is moving from ninety seconds to a hundred and
// fifty (the heartbeat is the deployment's largest database cost and a driver
// on a long haul beats for hours), so six minutes here.
//
// Widen this before the game slows down, never after: a build that beats
// every hundred and fifty seconds against a four-minute window has no margin
// for a single lost packet, while an older build beating every ninety seconds
// against six minutes only lingers a little longer after a crash.
export const PRESENCE_TTL_MS = 6 * 60_000;

// A driver whose activity/detail have not changed for this long is idle: a
// truck parked on the road with the game left running (a paused game already
// counts as off duty and stops reporting). The row keeps beating, so the TTL
// never expires it — the public surfaces just stop showing it. New game
// builds sign themselves off on the same clock (IDLE_SIGNOFF_S in
// online_presence.py); this filter is what ages older builds off the board.
// While actually driving the strings tick every five percent of progress, so
// half an hour of no change really does mean a parked truck.
export const PRESENCE_IDLE_MS = 30 * 60_000;
export const PRESENCE_WRITE_LIMIT = 30;
export const DRIVER_EVENT_WRITE_LIMIT = 120;
export const DRIVER_EVENT_CLOCK_SKEW_MS = 24 * 60 * 60_000;
export const MAX_DRIVER_EVENTS = 50;
export const SHARING_CONSENT_VERSION = 3;

// --- Account-issued driver identity (Clerk) ---
//
// Drivers are Clerk accounts now. After sign-in the setup page calls
// provisionDriver, which mints a driver token the player pastes into the
// desktop game once. The game keeps sending that token as a Bearer header
// exactly as before, so updatePresence/recordDriverEvent are unchanged; only
// where the token comes from moved to Clerk.

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// Must byte-for-byte match hashFreightFateToken in lib/freight-fate-online.ts
// (node:crypto sha256 of the utf8 token, lowercase hex). The game's Bearer
// token is hashed by that function on the REST path, then compared here, so a
// mismatch would silently fail the game's auth.
async function hashDriverToken(token: string) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

function mintDriverToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // 4 + 64 = 68 chars, comfortably inside normalizeFreightFateToken's 24..512.
  return `ffd_${toHex(bytes)}`;
}

// --- Per-computer tokens ---
//
// Every computer the player connects gets its own token row, so adding a
// laptop never retires the desktop's sign-in (Freight Fate issue #64). A
// driver row's legacy driverTokenHash (from before the computer list) stays
// accepted until the owner retires it from the setup page.

// Enough for any real household of gaming machines; a cap only so a scripted
// caller cannot grow the table unbounded.
export const MAX_DEVICE_TOKENS = 10;

// lastUsedAt is patched at most this often per device: coarse enough that a
// one-a-minute heartbeat costs one extra write every six hours, fresh enough
// to answer "which computer was this again" on the setup page.
export const DEVICE_TOKEN_USE_STAMP_MS = 6 * 60 * 60_000;

function normalizeDeviceLabel(value: string | undefined) {
  const label = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
  return label || "My computer";
}

async function findDeviceToken(ctx: QueryCtx, driverId: string, tokenHash: string) {
  return await ctx.db
    .query("freightFateDeviceTokens")
    .withIndex("by_driver_token", (q) => q.eq("driverId", driverId).eq("tokenHash", tokenHash))
    .unique();
}

// The one token check every authenticated game call goes through: the legacy
// single token or any active device token signs the driver in. Never call
// before the rate limiter — a token guess must stay as cheap as a wrong one.
//
// Returns the device row it matched, so a caller that also wants to stamp the
// row does not have to look it up a second time. A legacy-token driver
// matches with no row at all, hence accepted and device being separate.
export async function acceptDriverToken(
  ctx: QueryCtx,
  driver: Doc<"freightFateDrivers">,
  tokenHash: string,
) {
  if (driver.driverTokenHash !== undefined && driver.driverTokenHash === tokenHash) {
    return { accepted: true, device: null };
  }
  const device = await findDeviceToken(ctx, driver.driverId, tokenHash);
  return { accepted: device !== null, device };
}

export async function driverTokenAccepted(
  ctx: QueryCtx,
  driver: Doc<"freightFateDrivers">,
  tokenHash: string,
) {
  return (await acceptDriverToken(ctx, driver, tokenHash)).accepted;
}

// Mutation-path companion to acceptDriverToken: after a successful check,
// coarsely stamp the device row so the setup page can say when each computer
// last played. Legacy-token traffic has no row to stamp, so device is null.
export async function stampDeviceTokenUse(
  ctx: MutationCtx,
  device: Doc<"freightFateDeviceTokens"> | null,
  now: number,
) {
  if (device && (device.lastUsedAt === undefined || now - device.lastUsedAt > DEVICE_TOKEN_USE_STAMP_MS)) {
    await ctx.db.patch(device._id, { lastUsedAt: now });
  }
}

export async function mintDeviceTokenRow(
  ctx: MutationCtx,
  driverId: string,
  label: string | undefined,
  now: number,
  machineKey?: string,
) {
  const token = mintDriverToken();
  await ctx.db.insert("freightFateDeviceTokens", {
    driverId,
    tokenHash: await hashDriverToken(token),
    label: normalizeDeviceLabel(label),
    machineKey: normalizeMachineKey(machineKey),
    createdAt: now,
  });
  return token;
}

// Opaque and bounded: the game sends a hash, and anything that is not a
// plausible one is dropped rather than stored, so a malformed value can never
// collide two real computers onto one row.
export function normalizeMachineKey(value: string | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{16,64}$/.test(key) ? key : undefined;
}

// The driver's existing row for this computer, if the game named one.
export async function findDeviceRowForMachine(
  ctx: MutationCtx,
  driverId: string,
  machineKey: string | undefined,
) {
  const key = normalizeMachineKey(machineKey);
  if (!key) return null;
  const rows = await ctx.db
    .query("freightFateDeviceTokens")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .collect();
  return rows.find((row) => row.machineKey === key) ?? null;
}

// Produce a public slug already in normalizeFreightFateDriverId's canonical
// form (lowercase, [a-z0-9_-], no leading/trailing dash, 8..64) so the id the
// game echoes back round-trips through that normalizer unchanged.
export function driverIdFromName(displayName: string) {
  const base =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "driver";
  const suffix = new Uint8Array(4);
  crypto.getRandomValues(suffix);
  return `${base}-${toHex(suffix)}`.slice(0, 64);
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48) || "Freight Fate Driver";
}

// Two drivers named "Orinks" on the board are indistinguishable to a player
// hearing the list, so display names are unique across accounts. Stored
// names are already whitespace-normalized (above), so a case-insensitive
// compare is the whole rule. The drivers table is small and provisioning is
// rare, so a scan beats maintaining a normalized index column.
export async function displayNameTaken(ctx: QueryCtx, displayName: string, exceptSubject: string) {
  const key = displayName.toLowerCase();
  const drivers = await ctx.db.query("freightFateDrivers").collect();
  return drivers.some(
    (driver) => driver.authSubject !== exceptSubject && driver.displayName.toLowerCase() === key,
  );
}

// Thrown as ConvexError so the code survives production error redaction and
// the setup page can put a specific message on the name field.
const NAME_TAKEN = { code: "name_taken" as const };

function clampOccurredAt(occurredAt: number, now: number) {
  if (occurredAt > now + DRIVER_EVENT_CLOCK_SKEW_MS) {
    return now;
  }

  if (occurredAt < now - DRIVER_EVENT_CLOCK_SKEW_MS) {
    return now - DRIVER_EVENT_CLOCK_SKEW_MS;
  }

  return occurredAt;
}

function cleanFact(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function deliverySummary(payload: {
  cargo: string; weightPounds: number; origin: string; destination: string;
  distanceMiles: number; onTime: boolean; notableCondition?: string;
}) {
  const weight = Math.max(0, Math.round(payload.weightPounds)).toLocaleString("en-US");
  const distance = Math.max(0, Math.round(payload.distanceMiles)).toLocaleString("en-US");
  const condition = payload.notableCondition ? ` ${cleanFact(payload.notableCondition, 60)}.` : "";
  return `${cleanFact(payload.cargo, 80)}, ${weight} pounds, delivered from ${cleanFact(payload.origin, 80)} to ${cleanFact(payload.destination, 80)} over ${distance} miles${payload.onTime ? " on time" : ""}.${condition}`.slice(0, 280);
}

async function pruneDriverEvents(ctx: MutationCtx, driverId: string) {
  const events = await ctx.db.query("freightFateDriverEvents")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect();
  events.sort((a, b) => b.occurredAt - a.occurredAt || b.eventId.localeCompare(a.eventId));
  for (const row of events.slice(MAX_DRIVER_EVENTS)) await ctx.db.delete(row._id);
}

// Remember which game build a driver posts from. The version rides in on the
// game's User-Agent (parsed by freightFateClientVersion in
// lib/freight-fate-online.ts) with every authenticated write; the driver row
// is only patched when the string changes, so steady one-a-minute heartbeats
// cost no extra writes. Call only after the token hash has been verified —
// an unauthenticated guess must not leave a mark on the driver row.
export async function stampClientVersion(
  ctx: MutationCtx,
  driver: Doc<"freightFateDrivers">,
  clientVersion: string | undefined,
  now: number,
) {
  if (!clientVersion || driver.lastClientVersion === clientVersion) {
    return;
  }
  await ctx.db.patch(driver._id, {
    lastClientVersion: clientVersion.slice(0, 64),
    lastClientVersionAt: now,
  });
}

async function authenticatedSharingDriver(ctx: MutationCtx, args: {
  driverId: string; driverTokenHash: string; now: number; scope: string; limit: number;
}) {
  const driver = await ctx.db.query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
  if (!driver) return { error: "driver_not_found" as const };
  const allowed = await consumeFreightFateWrite(ctx, args);
  if (!allowed) return { error: "rate_limited" as const };
  if (!(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
    return { error: "unauthorized" as const };
  }
  if (driver.sharingConsentVersion !== SHARING_CONSENT_VERSION || driver.visibility !== "public") {
    return { error: "sharing_not_enabled" as const };
  }
  return { driver };
}

export const getMyDriver = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();

    if (!driver) {
      return null;
    }

    // Never returns a token — tokens exist only as hashes and are shown once
    // at issuance. hasToken lets the UI say "a token is active" without one.
    const anyDevice = await ctx.db
      .query("freightFateDeviceTokens")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
      .first();
    return {
      driverId: driver.driverId,
      displayName: driver.displayName,
      visibility: driver.visibility,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
      hasToken: driver.driverTokenHash !== undefined || anyDevice !== null,
      needsRename: driver.needsRename === true,
      sharingEnabled:
        driver.sharingConsentVersion === SHARING_CONSENT_VERSION && driver.visibility === "public",
    };
  },
});

export const provisionDriver = mutation({
  args: {
    displayName: v.string(),
    visibility,
    // This mutation never mints a token, on first provision or after a
    // rotate. A computer only gets one by activating itself
    // (convex/freightFateActivation.ts), which is also the only path that can
    // actually deliver a token to the computer that needs it: the setup page
    // has nowhere to put one. Minting here left every new driver a device row
    // no computer held.
    //
    // rotateToken remains the panic switch: it signs out every computer —
    // legacy token and all device rows — and leaves the driver with none, so
    // each computer must activate again.
    rotateToken: v.optional(v.boolean()),
    expandedSharingConsent: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("You must be signed in to set up a Freight Fate driver.");
    }

    const displayName = normalizeDisplayName(args.displayName);

    // Enforce the published naming rules (/freight-fate/online/rules) before
    // the name is stored or a public slug is derived from it. The client maps
    // the reason to its inline field error.
    const verdict = screenDisplayName(displayName);
    if (!verdict.ok) {
      throw new ConvexError({ code: "name_rejected", reason: verdict.reason });
    }

    const existing = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();

    if (existing) {
      // Only a rename is checked: a pre-existing duplicate (from before this
      // rule) must not lock its owner out of saving unrelated changes.
      const renaming = existing.displayName.toLowerCase() !== displayName.toLowerCase();
      if (renaming && (await displayNameTaken(ctx, displayName, identity.subject))) {
        throw new ConvexError(NAME_TAKEN);
      }
      const patch: {
        displayName: string;
        visibility: typeof args.visibility;
        updatedAt: number;
        // Patching undefined removes the field: a screened name satisfies a
        // moderation force-rename, so the flag clears here.
        needsRename: undefined;
        sharingConsentVersion?: number | undefined;
        sharingConsentedAt?: number | undefined;
        driverTokenHash?: string | undefined;
      } = {
        displayName,
        visibility:
          args.expandedSharingConsent === true
            ? "public"
            : args.expandedSharingConsent === false
              ? "private"
              : existing.visibility,
        updatedAt: args.now,
        needsRename: undefined,
      };
      if (args.expandedSharingConsent === true) {
        patch.sharingConsentVersion = SHARING_CONSENT_VERSION;
        patch.sharingConsentedAt = args.now;
      } else if (args.expandedSharingConsent === false) {
        patch.sharingConsentVersion = undefined;
        patch.sharingConsentedAt = undefined;
      }

      const rotated = args.rotateToken === true;
      if (rotated) {
        // The full sign-out: every computer's token dies and none is issued
        // in its place. This is the "my token leaked" recovery, so it must
        // not leave any older credential alive — including the legacy
        // single token. Every computer, this one included, activates again.
        const devices = await ctx.db
          .query("freightFateDeviceTokens")
          .withIndex("by_driver_id", (q) => q.eq("driverId", existing.driverId))
          .collect();
        for (const device of devices) {
          await ctx.db.delete(device._id);
        }
        patch.driverTokenHash = undefined;
      }

      await ctx.db.patch(existing._id, patch);

      return { driverId: existing.driverId, rotated };
    }

    if (await displayNameTaken(ctx, displayName, identity.subject)) {
      throw new ConvexError(NAME_TAKEN);
    }

    // Regenerate on the rare slug collision so the public id stays unique.
    let driverId = driverIdFromName(displayName);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
        .unique();
      if (!clash) {
        break;
      }
      driverId = driverIdFromName(displayName);
    }

    await ctx.db.insert("freightFateDrivers", {
      driverId,
      displayName,
      visibility: args.expandedSharingConsent ? "public" : "private",
      authSubject: identity.subject,
      ...(args.expandedSharingConsent
        ? { sharingConsentVersion: SHARING_CONSENT_VERSION, sharingConsentedAt: args.now }
        : {}),
      createdAt: args.now,
      updatedAt: args.now,
    });
    // No token here: the driver exists, and the first computer gets its own
    // by activating from the game.
    return { driverId, rotated: false };
  },
});

// --- The setup page's computer list ---

// The Clerk-authenticated driver row, or null. The computer-list functions
// below authenticate by account, never by driver token: only the owner can
// see or manage their computers.
export async function driverForIdentity(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();
}

export const getMyComputers = query({
  args: {},
  handler: async (ctx) => {
    const driver = await driverForIdentity(ctx);
    if (!driver) {
      return null;
    }
    const devices = await ctx.db
      .query("freightFateDeviceTokens")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
      .collect();
    devices.sort((a, b) => a.createdAt - b.createdAt);
    return {
      computers: devices.map((device) => ({
        id: device._id,
        label: device.label,
        createdAt: device.createdAt,
        lastUsedAt: device.lastUsedAt ?? null,
      })),
      // A pre-computer-list token may still be pasted into a game somewhere;
      // the page shows it as its own entry so it can be retired deliberately.
      hasLegacyToken: driver.driverTokenHash !== undefined,
    };
  },
});

// A computer is added by activating it from the game
// (convex/freightFateActivation.ts), which is the only path that can hand
// the new token to the computer that asked for it. There is no browser-side
// add: a mutation here could only mint a token the page has nowhere to put.

export const removeComputer = mutation({
  args: {
    // "legacy" retires the pre-computer-list single token.
    tokenId: v.union(v.id("freightFateDeviceTokens"), v.literal("legacy")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await driverForIdentity(ctx);
    if (!driver) {
      throw new Error("You must be signed in to remove a computer.");
    }
    if (args.tokenId === "legacy") {
      if (driver.driverTokenHash !== undefined) {
        await ctx.db.patch(driver._id, { driverTokenHash: undefined, updatedAt: args.now });
      }
      return { removed: true };
    }
    const device = await ctx.db.get(args.tokenId);
    if (!device || device.driverId !== driver.driverId) {
      // Owned-by-someone-else and already-gone look identical on purpose.
      return { removed: false };
    }
    await ctx.db.delete(device._id);
    await ctx.db.patch(driver._id, { updatedAt: args.now });
    return { removed: true };
  },
});

export const recordDriverEvent = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    summary: v.string(),
    occurredAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      return { ok: false as const, reason: "driver_not_found" };
    }

    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "driver-event",
      driverId: args.driverId,
      now: args.now,
      limit: DRIVER_EVENT_WRITE_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, reason: "rate_limited" };
    }

    if (!(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
      return { ok: false as const, reason: "unauthorized" };
    }

    if (driver.sharingConsentVersion !== SHARING_CONSENT_VERSION) {
      return { ok: false as const, reason: "sharing_not_enabled" };
    }

    const existingEvent = await ctx.db
      .query("freightFateDriverEvents")
      .withIndex("by_driver_event", (q) => q.eq("driverId", args.driverId).eq("eventId", args.eventId))
      .unique();

    if (existingEvent) {
      return { ok: true as const, duplicate: true, driverId: args.driverId };
    }

    await ctx.db.insert("freightFateDriverEvents", {
      driverId: args.driverId,
      eventId: args.eventId,
      eventType: args.eventType,
      summary: args.summary,
      occurredAt: clampOccurredAt(args.occurredAt, args.now),
      createdAt: args.now,
    });

    await ctx.db.patch(driver._id, { updatedAt: args.now });

    const events = await ctx.db
      .query("freightFateDriverEvents")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .collect();
    events.sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt);
    for (const row of events.slice(MAX_DRIVER_EVENTS)) {
      await ctx.db.delete(row._id);
    }

    return { ok: true as const, duplicate: false, driverId: args.driverId };
  },
});

// How many drivers either board reads at most. The live query re-runs for
// every status change, so this is also the ceiling on what one re-execution
// can cost.
export const MAX_BOARD_ROWS = 100;

/** Whether a driver may appear on the public board, and under what name.
 *
 * Folded into the presence row at heartbeat time rather than checked when the
 * board is read: the live query must never open a driver document (see the
 * note on freightFatePresence in schema.ts). Anything that changes one of
 * these three conditions outside a heartbeat has to reach into the presence
 * row itself -- setProfileSharing and setIntegrityFlag both do.
 */
function boardListing(driver: Doc<"freightFateDrivers">) {
  return {
    displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver"),
    listed:
      driver.visibility === "public" &&
      driver.sharingConsentVersion === SHARING_CONSENT_VERSION &&
      !driver.integrityFlag,
  };
}

export const updatePresence = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    activity: v.string(),
    detail: v.string(),
    clientVersion: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      return { ok: false as const, reason: "driver_not_found" };
    }

    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "presence",
      driverId: args.driverId,
      now: args.now,
      limit: PRESENCE_WRITE_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, reason: "rate_limited" };
    }

    const { accepted, device } = await acceptDriverToken(ctx, driver, args.driverTokenHash);
    if (!accepted) {
      return { ok: false as const, reason: "unauthorized" };
    }

    await stampClientVersion(ctx, driver, args.clientVersion, args.now);
    await stampDeviceTokenUse(ctx, device, args.now);

    const beat = await ctx.db
      .query("freightFatePresenceBeats")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    const existing = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    // An empty activity is an explicit "off duty" sign-off from the game.
    if (!args.activity) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      if (beat) {
        await ctx.db.delete(beat._id);
      }
      return { ok: true as const, cleared: true };
    }

    // The clock always moves. Nothing subscribes to this table, so a beat
    // that changes nothing a reader could see costs one small write and
    // wakes no board.
    if (beat) {
      await ctx.db.patch(beat._id, { updatedAt: args.now });
    } else {
      await ctx.db.insert("freightFatePresenceBeats", {
        driverId: args.driverId,
        updatedAt: args.now,
      });
    }

    // The board row moves only when a reader would see a difference. This
    // early return is the whole point of the split: a driver parked at a dock
    // or grinding out a long leg between progress ticks beats every hundred
    // and fifty seconds and writes nothing here, so every browser watching
    // the board stays quiet too.
    const listing = boardListing(driver);
    if (!existing) {
      await ctx.db.insert("freightFatePresence", {
        driverId: args.driverId,
        activity: args.activity,
        detail: args.detail,
        changedAt: args.now,
        ...listing,
      });
      return { ok: true as const, cleared: false };
    }

    const changed =
      existing.activity !== args.activity || existing.detail !== args.detail;
    if (
      changed ||
      existing.displayName !== listing.displayName ||
      existing.listed !== listing.listed ||
      existing.changedAt === undefined
    ) {
      await ctx.db.patch(existing._id, {
        activity: args.activity,
        detail: args.detail,
        // Pre-split rows have no changedAt; baseline them at this beat so a
        // long-parked driver gets one full idle window from deploy, not an
        // instant drop.
        changedAt: changed ? args.now : existing.changedAt ?? args.now,
        ...listing,
      });
    }

    return { ok: true as const, cleared: false };
  },
});

/** Drop drivers whose heartbeat has stopped.
 *
 * Expiry used to piggyback on heartbeat writes, which worked while every beat
 * wrote to the board table anyway. Now that a beat usually writes nothing
 * there, a driver whose game crashed would sit on the board until somebody
 * else happened to change status, so the sweep is its own scheduled pass.
 *
 * Runs every minute against a six-minute TTL, and on the overwhelmingly
 * common tick it reads one empty index range and writes nothing at all --
 * which matters, because a sweep that wrote on every tick would wake every
 * subscribed board once a minute for no reason.
 */
export const sweepStalePresence = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const stale = await ctx.db
      .query("freightFatePresenceBeats")
      .withIndex("by_updated", (q) => q.lt("updatedAt", now - PRESENCE_TTL_MS))
      .take(200);

    for (const beat of stale) {
      const row = await ctx.db
        .query("freightFatePresence")
        .withIndex("by_driver_id", (q) => q.eq("driverId", beat.driverId))
        .unique();
      if (row) {
        await ctx.db.delete(row._id);
      }
      await ctx.db.delete(beat._id);
    }

    return { swept: stale.length };
  },
});

/** One-off: give the rows written before the split their heartbeat back.
 *
 * Rows from the previous deploy carry the clock on the board row itself and
 * have no freightFatePresenceBeats entry at all, which every read here treats
 * as "stopped talking to us". Left alone that empties the board for everyone
 * until each driver's next beat, so this hands the old clock across instead of
 * throwing it away; rows already past the TTL are simply dropped, which is
 * what the sweep would have done to them anyway.
 *
 * Deliberately NOT on the cron. Every live path writes and deletes the two
 * rows together, so once this has run an orphan cannot occur again -- and a
 * reconciling scan of the whole board table every minute would cost more
 * database bandwidth on its own than the live board it was protecting. Run it
 * by hand, once, right after the deploy that adds freightFatePresenceBeats:
 *
 *   npx convex run freightFate:migrateLegacyPresence
 *
 * Safe to run twice: a row that already has a beat is left alone.
 */
export const migrateLegacyPresence = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let carried = 0;
    let dropped = 0;

    for await (const row of ctx.db.query("freightFatePresence")) {
      const beat = await ctx.db
        .query("freightFatePresenceBeats")
        .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId))
        .unique();
      if (beat) {
        continue;
      }

      const lastBeat = row.updatedAt;
      if (lastBeat !== undefined && lastBeat >= now - PRESENCE_TTL_MS) {
        await ctx.db.insert("freightFatePresenceBeats", {
          driverId: row.driverId,
          updatedAt: lastBeat,
        });
        carried += 1;
      } else {
        await ctx.db.delete(row._id);
        dropped += 1;
      }
    }

    return { carried, dropped };
  },
});

/** Authoritative "who is on duty", read against a caller-supplied clock.
 *
 * Reads the heartbeat table and re-checks every driver document, so it is
 * correct the instant it runs and expensive enough that it must not be
 * subscribed to. Two callers, both cheap by construction: the once-a-minute
 * cached snapshot behind the site and the game's own board endpoint. Anything
 * a browser watches continuously wants getLivePresenceBoard.
 */
export const getPresenceBoard = query({
  args: {
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const fresh = await ctx.db
      .query("freightFatePresenceBeats")
      .withIndex("by_updated", (q) => q.gte("updatedAt", args.now - PRESENCE_TTL_MS))
      .order("desc")
      .take(MAX_BOARD_ROWS);

    // Only drivers who chose the public listing appear on the board.
    const drivers = [];
    for (const beat of fresh) {
      const row = await ctx.db
        .query("freightFatePresence")
        .withIndex("by_driver_id", (q) => q.eq("driverId", beat.driverId))
        .unique();
      if (!row) {
        continue;
      }
      // Still beating but nothing has changed in half an hour: a parked
      // truck with the game left running, not a live driver.
      if ((row.changedAt ?? beat.updatedAt) < args.now - PRESENCE_IDLE_MS) {
        continue;
      }
      const driver = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", beat.driverId))
        .unique();
      if (
        !driver ||
        driver.visibility !== "public" ||
        driver.sharingConsentVersion !== SHARING_CONSENT_VERSION ||
        driver.integrityFlag
      ) {
        continue;
      }
      drivers.push({
        driverId: beat.driverId,
        // Safety net for names stored before write-time screening existed.
        displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver"),
        activity: row.activity,
        detail: row.detail,
        // The heartbeat clock, which is what the game's own drivers list
        // shows and has always meant "last heard from".
        updatedAt: beat.updatedAt,
        // When the status itself last moved, which is what the website shows.
        changedAt: row.changedAt ?? beat.updatedAt,
      });
    }

    return { drivers, asOf: args.now };
  },
});

/** The board as a browser subscribes to it: one index scan, no clock.
 *
 * Three properties, and every one of them is load-bearing for what this costs
 * to keep open:
 *
 * - **No arguments.** Convex caches a query result per (function, arguments),
 *   so identical arguments mean one execution shared by every subscriber. The
 *   moment a timestamp is passed in, each browser gets its own execution and
 *   the bill starts tracking viewers instead of drivers. Do not add an
 *   argument here, and in particular do not add `now`.
 * - **One table.** No driver documents, no heartbeat rows -- so nothing but a
 *   real, visible status change re-runs it or wakes a reader.
 * - **No server timestamp in the result.** Freshness is decided by the reader
 *   against absolute `changedAt` stamps. An `asOf` baked into the result
 *   would be frozen at whatever moment the query last happened to run, and a
 *   board that had been quiet for twenty minutes would date itself twenty
 *   minutes ago.
 *
 * Rows the reader should hide -- gone idle, or beating but since dropped by
 * the sweep -- are filtered by the reader for the same reason: a clock that
 * ticks on the server costs a database read every time it ticks, and one in
 * the browser costs nothing.
 */
export const getLivePresenceBoard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_changed")
      .order("desc")
      .take(MAX_BOARD_ROWS);

    return {
      drivers: rows
        // `listed` absent means the row predates the denormalization and
        // nothing here knows whether its driver opted in; the next heartbeat
        // settles it. Hiding is the safe way to be wrong for one beat.
        .filter((row) => row.listed === true && row.changedAt !== undefined)
        .map((row) => ({
          driverId: row.driverId,
          displayName: row.displayName ?? "Driver",
          activity: row.activity,
          detail: row.detail,
          changedAt: row.changedAt as number,
        })),
    };
  },
});

export const setProfileSharing = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    enabled: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db.query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    if (!driver) return { ok: false as const, reason: "driver_not_found" };
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "profile_sharing", driverId: args.driverId, now: args.now, limit: 12,
    });
    if (!allowed) return { ok: false as const, reason: "rate_limited" };
    if (!(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
      return { ok: false as const, reason: "unauthorized" };
    }
    await ctx.db.patch(driver._id, {
      visibility: args.enabled ? "public" : "private",
      sharingConsentVersion: args.enabled ? SHARING_CONSENT_VERSION : undefined,
      sharingConsentedAt: args.enabled ? args.now : undefined,
      updatedAt: args.now,
    });
    // The live board reads a denormalized `listed` flag rather than this
    // driver row, so a sharing change has to reach the presence row itself or
    // it would not take effect until the next heartbeat. Turning sharing off
    // is the direction that must be instant.
    const presence = await ctx.db.query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    if (presence) {
      if (args.enabled) {
        await ctx.db.patch(presence._id, { listed: !driver.integrityFlag });
      } else {
        await ctx.db.delete(presence._id);
      }
    }
    return { ok: true as const, enabled: args.enabled };
  },
});

export const publishDeliveryCompleted = mutation({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), eventId: v.string(),
    occurredAt: v.number(), now: v.number(),
    payload: v.object({
      version: v.literal(1), cargo: v.string(), weightPounds: v.number(),
      origin: v.string(), destination: v.string(), distanceMiles: v.number(),
      onTime: v.boolean(), notableCondition: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const auth = await authenticatedSharingDriver(ctx, {
      ...args, scope: "driver-event", limit: DRIVER_EVENT_WRITE_LIMIT,
    });
    if ("error" in auth) return { ok: false as const, reason: auth.error };
    const existing = await ctx.db.query("freightFateDriverEvents")
      .withIndex("by_driver_event", (q) => q.eq("driverId", args.driverId).eq("eventId", args.eventId)).unique();
    if (existing) return { ok: true as const, duplicate: true, driverId: args.driverId };
    await ctx.db.insert("freightFateDriverEvents", {
      driverId: args.driverId, eventId: cleanFact(args.eventId, 96),
      eventType: "delivery_completed", summary: deliverySummary(args.payload),
      payloadVersion: 1, payload: args.payload,
      occurredAt: clampOccurredAt(args.occurredAt, args.now), createdAt: args.now,
    });
    await pruneDriverEvents(ctx, args.driverId);
    return { ok: true as const, duplicate: false, driverId: args.driverId };
  },
});

export const publishAchievementEarned = mutation({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), eventId: v.string(),
    achievementKey: v.string(), name: v.string(), description: v.string(),
    earnedAt: v.number(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await authenticatedSharingDriver(ctx, {
      ...args, scope: "driver-event", limit: DRIVER_EVENT_WRITE_LIMIT,
    });
    if ("error" in auth) return { ok: false as const, reason: auth.error };
    const existing = await ctx.db.query("freightFateAchievements")
      .withIndex("by_driver_achievement", (q) => q.eq("driverId", args.driverId).eq("achievementKey", args.achievementKey)).unique();
    if (existing) return { ok: true as const, duplicate: true, driverId: args.driverId };
    const earnedAt = clampOccurredAt(args.earnedAt, args.now);
    const name = cleanFact(args.name, 100);
    const description = cleanFact(args.description, 240);
    await ctx.db.insert("freightFateAchievements", {
      driverId: args.driverId, achievementKey: cleanFact(args.achievementKey, 96),
      name, description, earnedAt, createdAt: args.now,
    });
    await ctx.db.insert("freightFateDriverEvents", {
      driverId: args.driverId, eventId: cleanFact(args.eventId, 96),
      eventType: "achievement_earned", summary: `${name}: ${description}`.slice(0, 280),
      payloadVersion: 1, payload: { achievementKey: cleanFact(args.achievementKey, 96), name, description },
      occurredAt: earnedAt, createdAt: args.now,
    });
    await pruneDriverEvents(ctx, args.driverId);
    return { ok: true as const, duplicate: false, driverId: args.driverId };
  },
});

export const publishCareerMilestone = mutation({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), eventId: v.string(),
    milestoneType: v.union(v.literal("first_delivery"), v.literal("career_level")),
    level: v.optional(v.number()), occurredAt: v.number(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await authenticatedSharingDriver(ctx, {
      ...args, scope: "driver-event", limit: DRIVER_EVENT_WRITE_LIMIT,
    });
    if ("error" in auth) return { ok: false as const, reason: auth.error };
    const existing = await ctx.db.query("freightFateDriverEvents")
      .withIndex("by_driver_event", (q) => q.eq("driverId", args.driverId).eq("eventId", args.eventId)).unique();
    if (existing) return { ok: true as const, duplicate: true, driverId: args.driverId };
    const level = args.level === undefined ? undefined : Math.max(1, Math.min(999, Math.trunc(args.level)));
    const summary = args.milestoneType === "first_delivery"
      ? "Completed a first Freight Fate delivery."
      : `Reached driver level ${level ?? 1}.`;
    await ctx.db.insert("freightFateDriverEvents", {
      driverId: args.driverId, eventId: cleanFact(args.eventId, 96),
      eventType: "career_milestone", summary, payloadVersion: 1,
      payload: { milestoneType: args.milestoneType, ...(level ? { level } : {}) },
      occurredAt: clampOccurredAt(args.occurredAt, args.now), createdAt: args.now,
    });
    await pruneDriverEvents(ctx, args.driverId);
    return { ok: true as const, duplicate: false, driverId: args.driverId };
  },
});

export const getPublicUpdates = query({
  args: { limit: v.optional(v.number()), before: v.optional(v.object({ occurredAt: v.number(), eventId: v.string() })) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    // Stream the index newest-first and stop once a full page is in hand.
    // Whether an event is publishable is a property of its driver rather than
    // the event, so rows still have to be filtered after they are read — but
    // only the rows we actually need get read. Collecting the whole event
    // history to return twenty rows was this deployment's single largest
    // database-bandwidth cost (~1.5 MB per call against a 1 GB monthly cap).
    const drivers = new Map<string, Doc<"freightFateDrivers"> | null>();
    const updates = [];
    // occurredAt ties are broken by eventId, which the index does not order
    // by, so the tie group straddling the page boundary has to be read out in
    // full before sorting or a paged read could skip an event.
    let boundaryOccurredAt: number | null = null;
    for await (const row of ctx.db.query("freightFateDriverEvents")
      .withIndex("by_occurred", (q) => args.before ? q.lte("occurredAt", args.before.occurredAt) : q)
      .order("desc")) {
      if (boundaryOccurredAt !== null && row.occurredAt !== boundaryOccurredAt) break;
      if (args.before && row.occurredAt === args.before.occurredAt && row.eventId >= args.before.eventId) continue;
      let driver = drivers.get(row.driverId);
      if (driver === undefined) {
        driver = await ctx.db.query("freightFateDrivers")
          .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId)).unique();
        drivers.set(row.driverId, driver);
      }
      if (!driver || driver.visibility !== "public" ||
          driver.sharingConsentVersion !== SHARING_CONSENT_VERSION ||
          driver.integrityFlag) continue;
      updates.push({ ...row, displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver") });
      if (updates.length > limit && boundaryOccurredAt === null) boundaryOccurredAt = row.occurredAt;
    }
    updates.sort((a, b) => b.occurredAt - a.occurredAt || b.eventId.localeCompare(a.eventId));
    const page = updates.slice(0, limit);
    const last = page.at(-1);
    return { updates: page, nextBefore: updates.length > limit && last ? { occurredAt: last.occurredAt, eventId: last.eventId } : null };
  },
});

export const getDriverProfile = query({
  args: {
    driverId: v.string(),
    limit: v.optional(v.number()),
    before: v.optional(v.object({ occurredAt: v.number(), eventId: v.string() })),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      return null;
    }

    if (driver.visibility === "private") {
      return null;
    }

    if (driver.sharingConsentVersion !== SHARING_CONSENT_VERSION) {
      return null;
    }

    // A tamper-flagged career is not presented as real: the profile hides
    // exactly as a private one does until moderation clears the flag. The
    // player keeps playing and keeps cloud backups; only the public face
    // is held. Upload screening no longer raises this flag on its own — it
    // rejects the save and keeps the payload, and a human sets the flag from
    // that evidence (see recordRejectedUpload in freightFateSaves.ts).
    if (driver.integrityFlag) {
      return null;
    }

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    // Stream one page of history instead of the whole career. This read was
    // the deployment's largest remaining database cost after getPublicUpdates
    // was given the same treatment: about 23 KB per profile view, growing
    // with every delivery the driver ever posted, to show twenty rows.
    //
    // occurredAt ties are broken by eventId, which the index does not order
    // by, so the tie group straddling the page boundary is read out in full
    // before sorting — stopping the moment the page filled could drop an
    // event from the middle of the feed.
    const collected = [];
    let boundaryOccurredAt: number | null = null;
    for await (const row of ctx.db.query("freightFateDriverEvents")
      .withIndex("by_driver_occurred", (q) => args.before
        ? q.eq("driverId", args.driverId).lte("occurredAt", args.before.occurredAt)
        : q.eq("driverId", args.driverId))
      .order("desc")) {
      if (boundaryOccurredAt !== null && row.occurredAt !== boundaryOccurredAt) break;
      if (args.before && row.occurredAt === args.before.occurredAt && row.eventId >= args.before.eventId) continue;
      collected.push(row);
      if (collected.length > limit && boundaryOccurredAt === null) boundaryOccurredAt = row.occurredAt;
    }
    collected.sort((a, b) => b.occurredAt - a.occurredAt || b.eventId.localeCompare(a.eventId));
    const events = collected.slice(0, limit);
    const snapshot = await ctx.db.query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
    const presenceRow = await ctx.db.query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    const presenceBeat = await ctx.db.query("freightFatePresenceBeats")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    // Same rules as the board, and for the same reason it joins two tables:
    // the beat says whether the game is still talking to us, the row says
    // whether anything has happened lately. A parked-and-forgotten truck
    // should not read as "on duty" on the profile page either.
    const presence = presenceRow && presenceBeat && args.now !== undefined
      && presenceBeat.updatedAt >= args.now - PRESENCE_TTL_MS
      && (presenceRow.changedAt ?? presenceBeat.updatedAt) >= args.now - PRESENCE_IDLE_MS
      ? { activity: presenceRow.activity, detail: presenceRow.detail, updatedAt: presenceBeat.updatedAt }
      : null;
    // Same shape as the events above: earnedAt ties break by achievementKey,
    // which the index does not order by, so the boundary tie group is read in
    // full and the rest of the shelf is left on disk.
    const earned = [];
    let boundaryEarnedAt: number | null = null;
    for await (const row of ctx.db.query("freightFateAchievements")
      .withIndex("by_driver_earned", (q) => q.eq("driverId", args.driverId))
      .order("desc")) {
      if (boundaryEarnedAt !== null && row.earnedAt !== boundaryEarnedAt) break;
      earned.push(row);
      if (earned.length > limit && boundaryEarnedAt === null) boundaryEarnedAt = row.earnedAt;
    }
    const achievements = earned
      .sort((a, b) => b.earnedAt - a.earnedAt || b.achievementKey.localeCompare(a.achievementKey))
      .slice(0, limit);

    return {
      driver: {
        driverId: driver.driverId,
        // Safety net for names stored before write-time screening existed.
        displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver"),
        visibility: driver.visibility,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
      },
      events,
      nextBefore: collected.length > limit && events.at(-1) ? {
        occurredAt: events.at(-1)!.occurredAt, eventId: events.at(-1)!.eventId,
      } : null,
      snapshot: snapshot?.sourceRevision && snapshot.validatorVersion ? {
        version: snapshot.version, level: snapshot.level, careerTitle: snapshot.careerTitle,
        lastSavedCity: snapshot.lastSavedCity, deliveries: snapshot.deliveries,
        milesDriven: snapshot.milesDriven, reputation: snapshot.reputation,
        onTimeDeliveries: snapshot.onTimeDeliveries, truckName: snapshot.truckName,
        employmentStatus: snapshot.employmentStatus, capturedAt: snapshot.capturedAt,
        // 1.9 career data. lifetimeEarnings is the career's running earnings
        // total — never the current money balance, which is not stored here
        // at all. badgeCatalogSize rides along so the page can say "of N"
        // from the same export that validated the badges.
        lifetimeEarnings: snapshot.lifetimeEarnings, badgesEarned: snapshot.badgesEarned,
        badgeCatalogSize: snapshot.badgesEarned === undefined
          ? undefined
          : invariants.achievementIds.length,
        endorsements: snapshot.endorsements, fleetTier: snapshot.fleetTier,
      } : null,
      achievements,
      presence,
    };
  },
});
