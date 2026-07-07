import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const visibility = v.union(v.literal("public"), v.literal("private"), v.literal("unlisted"));

// A driver whose latest heartbeat is older than this is off the live board.
// The game sends a heartbeat roughly every minute, so three missed beats
// (game closed, went off duty, lost connection) removes the row.
export const PRESENCE_TTL_MS = 3 * 60_000;

export const createSetupSession = mutation({
  args: {
    setupTokenHash: v.string(),
    driverId: v.string(),
    driverTokenHash: v.string(),
    displayName: v.optional(v.string()),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("freightFateSetupSessions")
      .withIndex("by_setup_token", (q) => q.eq("setupTokenHash", args.setupTokenHash))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        driverId: args.driverId,
        driverTokenHash: args.driverTokenHash,
        displayName: args.displayName,
        expiresAt: args.expiresAt,
        confirmedAt: undefined,
      });
      return { saved: true, driverId: args.driverId, expiresAt: args.expiresAt };
    }

    await ctx.db.insert("freightFateSetupSessions", {
      setupTokenHash: args.setupTokenHash,
      driverId: args.driverId,
      driverTokenHash: args.driverTokenHash,
      displayName: args.displayName,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });

    return { saved: true, driverId: args.driverId, expiresAt: args.expiresAt };
  },
});

export const getSetupSession = query({
  args: {
    setupTokenHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("freightFateSetupSessions")
      .withIndex("by_setup_token", (q) => q.eq("setupTokenHash", args.setupTokenHash))
      .unique();

    if (!session) {
      return { found: false as const };
    }

    return {
      found: true as const,
      confirmed: Boolean(session.confirmedAt),
      expired: session.expiresAt < args.now,
      driverId: session.driverId,
      displayName: session.displayName,
      expiresAt: session.expiresAt,
      confirmedAt: session.confirmedAt,
    };
  },
});

export const confirmSetupSession = mutation({
  args: {
    setupTokenHash: v.string(),
    displayName: v.string(),
    visibility,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("freightFateSetupSessions")
      .withIndex("by_setup_token", (q) => q.eq("setupTokenHash", args.setupTokenHash))
      .unique();

    if (!session) {
      return { ok: false as const, reason: "not_found" };
    }

    if (session.expiresAt < args.now) {
      return { ok: false as const, reason: "expired", expiresAt: session.expiresAt };
    }

    const existingDriver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", session.driverId))
      .unique();

    if (existingDriver) {
      await ctx.db.patch(existingDriver._id, {
        displayName: args.displayName,
        visibility: args.visibility,
        driverTokenHash: session.driverTokenHash,
        updatedAt: args.now,
      });
    } else {
      await ctx.db.insert("freightFateDrivers", {
        driverId: session.driverId,
        displayName: args.displayName,
        visibility: args.visibility,
        driverTokenHash: session.driverTokenHash,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }

    await ctx.db.patch(session._id, { confirmedAt: args.now });

    return {
      ok: true as const,
      driverId: session.driverId,
      displayName: args.displayName,
      visibility: args.visibility,
    };
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
      occurredAt: args.occurredAt,
      createdAt: args.now,
    });

    await ctx.db.patch(driver._id, { updatedAt: args.now });

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
