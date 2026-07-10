import { internalMutation } from "./_generated/server";
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
