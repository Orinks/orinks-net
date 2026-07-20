import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { driverIdFromName } from "./freightFate";
import { screenDisplayName } from "./moderation";

// Moderation hammer for driver names that break the published naming rules
// (/freight-fate/online/rules). Internal-only: run it from the Convex
// dashboard or the CLI, e.g.
//
//   npx convex run freightFateAdmin:forceRename '{"driverId":"<id>"}'
//
// It replaces the display name with an anonymous placeholder (or the given
// newName) and sets needsRename, which the setup page surfaces as "choose a
// new name" — provisionDriver clears the flag once a screened name is saved.
//
// Pass regenerateId when the offending text is baked into the public slug
// itself (the slug is derived from the name). That rewrites the driverId on
// the driver row, its journal events, and its cloud saves, and drops the live
// presence row. The player's token keeps working, but the game posts under
// the old id until the player pastes the NEW Driver ID from the setup page,
// so expect their sharing to pause until they do.
export const forceRename = internalMutation({
  args: {
    driverId: v.string(),
    newName: v.optional(v.string()),
    regenerateId: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      throw new Error(`No driver with id "${args.driverId}".`);
    }

    const displayName = args.newName?.trim().replace(/\s+/g, " ").slice(0, 48) || `Driver ${driver.driverId.slice(-4)}`;
    const replacementVerdict = screenDisplayName(displayName);
    if (!replacementVerdict.ok) {
      throw new Error(`Replacement name "${displayName}" fails screening (${replacementVerdict.reason}).`);
    }

    let driverId = driver.driverId;

    if (args.regenerateId) {
      driverId = driverIdFromName(displayName);
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

      const events = await ctx.db
        .query("freightFateDriverEvents")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId))
        .collect();
      for (const event of events) {
        await ctx.db.patch(event._id, { driverId });
      }

      const saves = await ctx.db
        .query("freightFateSaves")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId))
        .collect();
      for (const save of saves) {
        await ctx.db.patch(save._id, { driverId });
      }

      const saveContent = await ctx.db
        .query("freightFateSaveContent")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId))
        .collect();
      for (const content of saveContent) {
        await ctx.db.patch(content._id, { driverId });
      }

      // Presence is ephemeral; the next heartbeat under the old id simply
      // reports driver_not_found until the player updates the game.
      const presence = await ctx.db
        .query("freightFatePresence")
        .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
        .unique();
      if (presence) {
        await ctx.db.delete(presence._id);
      }
    }

    await ctx.db.patch(driver._id, {
      driverId,
      displayName,
      needsRename: true,
      updatedAt: Date.now(),
    });

    return { driverId, displayName, regeneratedId: driverId !== args.driverId };
  },
});

// Set or clear a driver's save-tamper flag. This is now the ONLY way one is
// raised: upload screening rejects a bad save and keeps the payload
// (listRejectedUploads below), but never brands the account, because the
// arithmetic behind those verdicts proved wrong in the accusing direction.
// Decide from offline forensics, then stamp here. While flagged, the driver is
// hidden from the live board, the updates feed, and their public profile;
// their game and cloud backups keep working. Internal only:
//
//   npx convex run freightFateAdmin:setIntegrityFlag \
//     '{"driverId":"<id>","flag":"impossible_money"}' --prod
//   npx convex run freightFateAdmin:setIntegrityFlag \
//     '{"driverId":"<id>","flag":null}' --prod          # clear after review
export const setIntegrityFlag = internalMutation({
  args: {
    driverId: v.string(),
    flag: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      throw new Error(`No driver with id "${args.driverId}".`);
    }

    await ctx.db.patch(driver._id, {
      integrityFlag: args.flag === null ? undefined : args.flag.slice(0, 32),
      integrityFlaggedAt: args.flag === null ? undefined : Date.now(),
    });

    return {
      driverId: driver.driverId,
      displayName: driver.displayName,
      integrityFlag: args.flag,
    };
  },
});

// Who runs what: one line per driver with the game build it last posted from
// (stamped by updatePresence, journal events, or Cloud Backup upload) and any
// sticky save-tamper verdict from upload screening. Internal only — build
// identity and integrity flags are moderation data, never shown on the site.
// Run it from the dashboard or the CLI:
//
//   npx convex run freightFateAdmin:listClientVersions
//
// clientVersion is null for drivers who have not posted since version
// stamping shipped (or who run a game from before it); clientVersionAt is
// when the reported build was FIRST seen, not the last heartbeat. Clear a
// reviewed integrityFlag by editing the driver row in the dashboard.
export const listClientVersions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drivers = await ctx.db.query("freightFateDrivers").collect();
    return drivers
      .map((driver) => ({
        driverId: driver.driverId,
        displayName: driver.displayName,
        clientVersion: driver.lastClientVersion ?? null,
        clientVersionAt: driver.lastClientVersionAt ?? null,
        integrityFlag: driver.integrityFlag ?? null,
        integrityFlaggedAt: driver.integrityFlaggedAt ?? null,
      }))
      .sort((a, b) => (b.clientVersionAt ?? 0) - (a.clientVersionAt ?? 0));
  },
});

// Uploads rejected for self-contradicting arithmetic, newest first. Screening
// no longer brands an account on these — it rejects the upload and keeps the
// payload, and a flag is a human call made after reading one. Internal only:
//
//   npx convex run freightFateAdmin:listRejectedUploads --prod
//   npx convex run freightFateAdmin:listRejectedUploads '{"driverId":"<id>"}' --prod
//
// The payload itself is deliberately not returned here — pull it by _id and
// run it through ff-admin/save_forensics.py rather than eyeballing base64.
export const listRejectedUploads = internalQuery({
  args: { driverId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = args.driverId
      ? await ctx.db
        .query("freightFateRejectedUploads")
        .withIndex("by_driver", (q) => q.eq("driverId", args.driverId as string))
        .collect()
      : await ctx.db.query("freightFateRejectedUploads").collect();
    return rows
      .map((row) => ({
        id: row._id,
        driverId: row.driverId,
        reason: row.reason,
        saveName: row.saveName,
        saveVersion: row.saveVersion,
        clientVersion: row.clientVersion ?? null,
        contentHash: row.contentHash,
        rejectedAt: row.rejectedAt,
      }))
      .sort((a, b) => b.rejectedAt - a.rejectedAt);
  },
});
