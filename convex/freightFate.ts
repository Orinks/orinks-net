import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import { maskDisplayName, screenDisplayName } from "./moderation";

const visibility = v.union(v.literal("public"), v.literal("private"), v.literal("unlisted"));

// A driver whose latest heartbeat is older than this is off the live board.
// The game sends a heartbeat roughly every minute, so three missed beats
// (game closed, went off duty, lost connection) removes the row.
export const PRESENCE_TTL_MS = 3 * 60_000;
export const PRESENCE_WRITE_LIMIT = 30;
export const DRIVER_EVENT_WRITE_LIMIT = 120;
export const DRIVER_EVENT_CLOCK_SKEW_MS = 24 * 60 * 60_000;
export const MAX_DRIVER_EVENTS = 50;
export const SHARING_CONSENT_VERSION = 2;
export const PROFILE_SNAPSHOT_WRITE_LIMIT = 30;

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

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48) || "Freight Fate Driver";
}

// Two drivers named "Orinks" on the board are indistinguishable to a player
// hearing the list, so display names are unique across accounts. Stored
// names are already whitespace-normalized (above), so a case-insensitive
// compare is the whole rule. The drivers table is small and provisioning is
// rare, so a scan beats maintaining a normalized index column.
async function displayNameTaken(ctx: QueryCtx, displayName: string, exceptSubject: string) {
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

async function authenticatedSharingDriver(ctx: MutationCtx, args: {
  driverId: string; driverTokenHash: string; now: number; scope: string; limit: number;
}) {
  const driver = await ctx.db.query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
  if (!driver) return { error: "driver_not_found" as const };
  const allowed = await consumeFreightFateWrite(ctx, args);
  if (!allowed) return { error: "rate_limited" as const };
  if (driver.driverTokenHash !== args.driverTokenHash) return { error: "unauthorized" as const };
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

    // Never returns the token — it exists only as a hash and is shown once at
    // issuance. hasToken lets the UI say "a token is active" without it.
    return {
      driverId: driver.driverId,
      displayName: driver.displayName,
      visibility: driver.visibility,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
      hasToken: true,
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
    // First provision always mints a token. For an existing driver the token
    // is only re-minted when the player explicitly rotates it; otherwise the
    // pasted token in the game keeps working.
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
        driverTokenHash?: string;
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

      let token: string | null = null;
      if (args.rotateToken) {
        token = mintDriverToken();
        patch.driverTokenHash = await hashDriverToken(token);
      }

      await ctx.db.patch(existing._id, patch);

      return { driverId: existing.driverId, token, rotated: token !== null };
    }

    if (await displayNameTaken(ctx, displayName, identity.subject)) {
      throw new ConvexError(NAME_TAKEN);
    }

    const token = mintDriverToken();
    const driverTokenHash = await hashDriverToken(token);

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
      driverTokenHash,
      ...(args.expandedSharingConsent
        ? { sharingConsentVersion: SHARING_CONSENT_VERSION, sharingConsentedAt: args.now }
        : {}),
      createdAt: args.now,
      updatedAt: args.now,
    });

    return { driverId, token, rotated: false };
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

    if (driver.driverTokenHash !== args.driverTokenHash) {
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

export const updatePresence = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    activity: v.string(),
    detail: v.string(),
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

    if (driver.driverTokenHash !== args.driverTokenHash) {
      return { ok: false as const, reason: "unauthorized" };
    }

    const existing = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    // An empty activity is an explicit "off duty" sign-off from the game.
    if (!args.activity) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return { ok: true as const, cleared: true };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        activity: args.activity,
        detail: args.detail,
        updatedAt: args.now,
      });
    } else {
      await ctx.db.insert("freightFatePresence", {
        driverId: args.driverId,
        activity: args.activity,
        detail: args.detail,
        updatedAt: args.now,
      });
    }

    // Piggyback expiry cleanup on writes so the table never accumulates
    // stale rows without needing a scheduled job.
    const stale = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_updated", (q) => q.lt("updatedAt", args.now - PRESENCE_TTL_MS))
      .take(20);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    return { ok: true as const, cleared: false };
  },
});

export const getPresenceBoard = query({
  args: {
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const fresh = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_updated", (q) => q.gte("updatedAt", args.now - PRESENCE_TTL_MS))
      .order("desc")
      .take(100);

    // Only drivers who chose the public listing appear on the board.
    const drivers = [];
    for (const row of fresh) {
      const driver = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId))
        .unique();
      if (
        !driver ||
        driver.visibility !== "public" ||
        driver.sharingConsentVersion !== SHARING_CONSENT_VERSION
      ) {
        continue;
      }
      drivers.push({
        driverId: row.driverId,
        // Safety net for names stored before write-time screening existed.
        displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver"),
        activity: row.activity,
        detail: row.detail,
        updatedAt: row.updatedAt,
      });
    }

    return { drivers, asOf: args.now };
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

const snapshotArgs = {
  version: v.number(),
  level: v.number(),
  careerTitle: v.string(),
  lastSavedCity: v.string(),
  deliveries: v.number(),
  milesDriven: v.number(),
  reputation: v.number(),
  onTimeDeliveries: v.optional(v.number()),
  truckName: v.optional(v.string()),
  employmentStatus: v.optional(v.string()),
  capturedAt: v.number(),
};

export const publishProfileSnapshot = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    snapshot: v.object(snapshotArgs),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db.query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    if (!driver) return { ok: false as const, reason: "driver_not_found" };
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "profile-snapshot", driverId: args.driverId, now: args.now,
      limit: PROFILE_SNAPSHOT_WRITE_LIMIT,
    });
    if (!allowed) return { ok: false as const, reason: "rate_limited" };
    if (driver.driverTokenHash !== args.driverTokenHash) {
      return { ok: false as const, reason: "unauthorized" };
    }
    if (driver.sharingConsentVersion !== SHARING_CONSENT_VERSION) {
      return { ok: false as const, reason: "sharing_not_enabled" };
    }
    const s = args.snapshot;
    if (s.version !== 1 || s.level < 1 || s.level > 999 || s.deliveries < 0 ||
        s.milesDriven < 0 || s.reputation < 0 || s.reputation > 100) {
      return { ok: false as const, reason: "invalid_snapshot" };
    }
    const clean = {
      driverId: args.driverId, version: 1,
      level: Math.trunc(s.level), careerTitle: s.careerTitle.trim().slice(0, 80),
      lastSavedCity: s.lastSavedCity.trim().slice(0, 100),
      deliveries: Math.trunc(s.deliveries), milesDriven: Math.round(s.milesDriven * 10) / 10,
      reputation: Math.round(s.reputation * 10) / 10,
      ...(s.onTimeDeliveries === undefined ? {} : { onTimeDeliveries: Math.max(0, Math.trunc(s.onTimeDeliveries)) }),
      ...(s.truckName ? { truckName: s.truckName.trim().slice(0, 100) } : {}),
      ...(s.employmentStatus ? { employmentStatus: s.employmentStatus.trim().slice(0, 80) } : {}),
      capturedAt: clampOccurredAt(s.capturedAt, args.now), updatedAt: args.now,
    };
    const existing = await ctx.db.query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
    if (existing) await ctx.db.patch(existing._id, clean);
    else await ctx.db.insert("freightFateProfileSnapshots", clean);
    return { ok: true as const, driverId: args.driverId };
  },
});

export const getPublicUpdates = query({
  args: { limit: v.optional(v.number()), before: v.optional(v.object({ occurredAt: v.number(), eventId: v.string() })) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const rows = await ctx.db.query("freightFateDriverEvents")
      .withIndex("by_occurred", (q) => args.before ? q.lte("occurredAt", args.before.occurredAt) : q)
      .order("desc").collect();
    const updates = [];
    for (const row of rows) {
      const driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId)).unique();
      if (!driver || driver.visibility !== "public" ||
          driver.sharingConsentVersion !== SHARING_CONSENT_VERSION) continue;
      if (args.before && row.occurredAt === args.before.occurredAt && row.eventId >= args.before.eventId) continue;
      updates.push({ ...row, displayName: maskDisplayName(driver.displayName, driver.driverId, "Driver") });
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

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const allEvents = await ctx.db
      .query("freightFateDriverEvents")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .collect();
    const eligible = allEvents
      .filter((event) => args.before === undefined || event.occurredAt < args.before.occurredAt ||
        (event.occurredAt === args.before.occurredAt && event.eventId < args.before.eventId))
      .sort((a, b) => b.occurredAt - a.occurredAt || b.eventId.localeCompare(a.eventId));
    const events = eligible.slice(0, limit);
    const snapshot = await ctx.db.query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
    const presenceRow = await ctx.db.query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
    const presence = presenceRow && args.now !== undefined && presenceRow.updatedAt >= args.now - PRESENCE_TTL_MS
      ? { activity: presenceRow.activity, detail: presenceRow.detail, updatedAt: presenceRow.updatedAt }
      : null;
    const achievements = (await ctx.db.query("freightFateAchievements")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).collect())
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
      nextBefore: eligible.length > limit && events.at(-1) ? {
        occurredAt: events.at(-1)!.occurredAt, eventId: events.at(-1)!.eventId,
      } : null,
      snapshot: snapshot ? {
        version: snapshot.version, level: snapshot.level, careerTitle: snapshot.careerTitle,
        lastSavedCity: snapshot.lastSavedCity, deliveries: snapshot.deliveries,
        milesDriven: snapshot.milesDriven, reputation: snapshot.reputation,
        onTimeDeliveries: snapshot.onTimeDeliveries, truckName: snapshot.truckName,
        employmentStatus: snapshot.employmentStatus, capturedAt: snapshot.capturedAt,
      } : null,
      achievements,
      presence,
    };
  },
});
