// Guest drivers: playing Freight Fate online with no orinks.net account.
//
// A guest is an ordinary freightFateDrivers row with `guest: true` and no
// authSubject, signed in by an ordinary device token. Everything the game
// already does with a token (the board, profile sharing, the road journal,
// achievements) works for it unchanged. Two things differ:
//
// - The name is never typed. The route picks it from Hearken's word lists
//   (lib/hearken-online/names.js), like "Copper Fox 12", and this module only
//   accepts names of that shape. A guest can ask for another one.
// - No cloud backups: those are for restoring on another computer, which
//   needs an account (convex/freightFateSaves.ts refuses guests).
//
// Connecting an account from the game proves the guest with its token when
// it asks for a code. Claiming that code adopts the guest row when the
// account has no driver yet; when it has one, redeeming moves the guest's
// journal and achievements across and deletes the guest (mergeGuestInto).

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import {
  acceptDriverToken,
  displayNameTaken,
  mintDeviceTokenRow,
  pruneDriverEvents,
} from "./freightFate";

// The shape of a word-list guest name, as lib/hearken-online/names.js makes
// them. The route checks the words themselves with isGuestName.
export const GUEST_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+ [1-9][0-9]?$/;

// New guests one address may make in a minute, and site-wide. A player makes
// one; the site-wide cap bounds what a script spread over many addresses can
// add to the drivers table.
export const GUEST_CREATE_LIMIT = 3;
export const GUEST_CREATE_GLOBAL_LIMIT = 30;
export const GUEST_RENAME_LIMIT = 6;

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

// Not derived from the name, so a new name never leaves the old one in the
// profile address.
function guestDriverId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `guest-${toHex(bytes)}`;
}

export async function guestDriver(ctx: QueryCtx, driverId: string) {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .unique();
  return driver && driver.guest === true && driver.authSubject === undefined ? driver : null;
}

/** The guest a game proved with its token, or null. Never throws. */
export async function provenGuest(ctx: QueryCtx, driverId: string, tokenHash: string) {
  const guest = await guestDriver(ctx, driverId);
  if (!guest) return null;
  return (await acceptDriverToken(ctx, guest, tokenHash)).accepted ? guest : null;
}

export const createGuest = mutation({
  args: {
    clientKey: v.string(),
    name: v.string(),
    machineKey: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!GUEST_NAME.test(args.name)) {
      throw new ConvexError({ code: "bad_name" as const });
    }
    const allowed =
      (await consumeFreightFateWrite(ctx, {
        scope: "guest_create",
        driverId: args.clientKey.slice(0, 64),
        now: args.now,
        limit: GUEST_CREATE_LIMIT,
      })) &&
      (await consumeFreightFateWrite(ctx, {
        scope: "guest_create",
        driverId: "*",
        now: args.now,
        limit: GUEST_CREATE_GLOBAL_LIMIT,
      }));
    if (!allowed) {
      throw new ConvexError({ code: "rate_limited" as const });
    }
    // The route picks another name and tries again.
    if (await displayNameTaken(ctx, args.name, "")) {
      return { ok: false as const, code: "name_taken" as const };
    }
    const driverId = guestDriverId();
    await ctx.db.insert("freightFateDrivers", {
      driverId,
      displayName: args.name,
      guest: true,
      // Nothing is public until the game turns Profile sharing on, the same
      // consent step an account driver takes (setProfileSharing).
      visibility: "private",
      createdAt: args.now,
      updatedAt: args.now,
    });
    const token = await mintDeviceTokenRow(ctx, driverId, undefined, args.now, args.machineKey);
    return { ok: true as const, driverId, token, displayName: args.name };
  },
});

export const renameGuest = mutation({
  args: { driverId: v.string(), driverTokenHash: v.string(), name: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (!GUEST_NAME.test(args.name)) {
      throw new ConvexError({ code: "bad_name" as const });
    }
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (!driver) return { ok: false as const, reason: "driver_not_found" as const };
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "guest_rename",
      driverId: args.driverId,
      now: args.now,
      limit: GUEST_RENAME_LIMIT,
    });
    if (!allowed) return { ok: false as const, reason: "rate_limited" as const };
    if (!(await acceptDriverToken(ctx, driver, args.driverTokenHash)).accepted) {
      return { ok: false as const, reason: "unauthorized" as const };
    }
    if (driver.guest !== true || driver.authSubject !== undefined) {
      return { ok: false as const, reason: "not_a_guest" as const };
    }
    if (await displayNameTaken(ctx, args.name, "")) {
      return { ok: false as const, reason: "name_taken" as const };
    }
    await ctx.db.patch(driver._id, { displayName: args.name, updatedAt: args.now });
    // The live board reads the name from the presence row, so it changes
    // there now rather than on the next status change.
    const presence = await ctx.db
      .query("freightFatePresence")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (presence) await ctx.db.patch(presence._id, { displayName: args.name });
    return { ok: true as const, displayName: args.name };
  },
});

/**
 * Move a guest's public history onto an account's driver and delete the
 * guest. Journal entries and achievements move (one already on the account
 * stays as it is); the guest's computers, presence and counters go, since the
 * computer that connected has just been given the account's token.
 */
export async function mergeGuestInto(ctx: MutationCtx, guestId: string, accountDriverId: string) {
  const guest = await guestDriver(ctx, guestId);
  if (!guest || guestId === accountDriverId) return false;
  const account = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", accountDriverId))
    .unique();
  if (!account) return false;

  const events = await ctx.db
    .query("freightFateDriverEvents")
    .withIndex("by_driver", (q) => q.eq("driverId", guestId))
    .collect();
  for (const event of events) {
    const clash = await ctx.db
      .query("freightFateDriverEvents")
      .withIndex("by_driver_event", (q) => q.eq("driverId", accountDriverId).eq("eventId", event.eventId))
      .unique();
    if (clash) await ctx.db.delete(event._id);
    else await ctx.db.patch(event._id, { driverId: accountDriverId });
  }
  if (events.length > 0) await pruneDriverEvents(ctx, accountDriverId);

  const achievements = await ctx.db
    .query("freightFateAchievements")
    .withIndex("by_driver", (q) => q.eq("driverId", guestId))
    .collect();
  for (const achievement of achievements) {
    const clash = await ctx.db
      .query("freightFateAchievements")
      .withIndex("by_driver_achievement", (q) =>
        q.eq("driverId", accountDriverId).eq("achievementKey", achievement.achievementKey),
      )
      .unique();
    if (clash) await ctx.db.delete(achievement._id);
    else await ctx.db.patch(achievement._id, { driverId: accountDriverId });
  }

  const leftovers = await Promise.all([
    ctx.db.query("freightFateDeviceTokens").withIndex("by_driver_id", (q) => q.eq("driverId", guestId)).collect(),
    ctx.db.query("freightFatePresence").withIndex("by_driver_id", (q) => q.eq("driverId", guestId)).collect(),
    ctx.db.query("freightFatePresenceBeats").withIndex("by_driver_id", (q) => q.eq("driverId", guestId)).collect(),
  ]);
  for (const row of leftovers.flat()) await ctx.db.delete(row._id);

  if ((guest.lastOnDutyAt ?? 0) > (account.lastOnDutyAt ?? 0)) {
    await ctx.db.patch(account._id, { lastOnDutyAt: guest.lastOnDutyAt });
  }
  await ctx.db.delete(guest._id);
  return true;
}
