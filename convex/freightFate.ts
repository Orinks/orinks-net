import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { consumeFreightFateWrite } from "./freightFateRateLimit";

const visibility = v.union(v.literal("public"), v.literal("private"), v.literal("unlisted"));

// A driver whose latest heartbeat is older than this is off the live board.
// The game sends a heartbeat roughly every minute, so three missed beats
// (game closed, went off duty, lost connection) removes the row.
export const PRESENCE_TTL_MS = 3 * 60_000;
export const PRESENCE_WRITE_LIMIT = 30;
export const DRIVER_EVENT_WRITE_LIMIT = 120;
export const DRIVER_EVENT_CLOCK_SKEW_MS = 24 * 60 * 60_000;
export const MAX_DRIVER_EVENTS = 50;

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
function driverIdFromName(displayName: string) {
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

function clampOccurredAt(occurredAt: number, now: number) {
  if (occurredAt > now + DRIVER_EVENT_CLOCK_SKEW_MS) {
    return now;
  }

  if (occurredAt < now - DRIVER_EVENT_CLOCK_SKEW_MS) {
    return now - DRIVER_EVENT_CLOCK_SKEW_MS;
  }

  return occurredAt;
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
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("You must be signed in to set up a Freight Fate driver.");
    }

    const displayName = normalizeDisplayName(args.displayName);

    const existing = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();

    if (existing) {
      const patch: {
        displayName: string;
        visibility: typeof args.visibility;
        updatedAt: number;
        driverTokenHash?: string;
      } = {
        displayName,
        visibility: args.visibility,
        updatedAt: args.now,
      };

      let token: string | null = null;
      if (args.rotateToken) {
        token = mintDriverToken();
        patch.driverTokenHash = await hashDriverToken(token);
      }

      await ctx.db.patch(existing._id, patch);

      return { driverId: existing.driverId, token, rotated: token !== null };
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
      visibility: args.visibility,
      authSubject: identity.subject,
      driverTokenHash,
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
      if (!driver || driver.visibility !== "public") {
        continue;
      }
      drivers.push({
        driverId: row.driverId,
        displayName: driver.displayName,
        activity: row.activity,
        detail: row.detail,
        updatedAt: row.updatedAt,
      });
    }

    return { drivers, asOf: args.now };
  },
});

export const getDriverProfile = query({
  args: {
    driverId: v.string(),
    limit: v.optional(v.number()),
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

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const events = await ctx.db
      .query("freightFateDriverEvents")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .order("desc")
      .take(limit);

    return {
      driver: {
        driverId: driver.driverId,
        displayName: driver.displayName,
        visibility: driver.visibility,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
      },
      events,
    };
  },
});
