import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { KEEP_REVISIONS, MAX_SLOTS } from "./freightFateSaves";

const MAX_DRIVER_REVISIONS = MAX_SLOTS * KEEP_REVISIONS;
const MAX_DUPLICATE_ACHIEVEMENT_ROWS = 10;

export const listDriverBatch = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => ctx.db.query("freightFateDrivers").order("asc")
    .paginate(args.paginationOpts),
});

export const readVerifiedCareerCandidates = internalQuery({
  args: { driverId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("freightFateSaves")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .take(MAX_DRIVER_REVISIONS + 1);
    if (rows.length > MAX_DRIVER_REVISIONS) return { ok: false as const, reason: "revision_limit" };

    const latestByCareer = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!row.sig || !row.keyId || !row.signedAt || !row.validatorVersion) continue;
      const prior = latestByCareer.get(row.saveName);
      if (!prior || row.revision > prior.revision) latestByCareer.set(row.saveName, row);
    }

    const candidates = [];
    for (const row of [...latestByCareer.values()].sort((a, b) =>
      a.saveName.localeCompare(b.saveName) || a.revision - b.revision,
    )) {
      const content = await ctx.db.get(row.contentId);
      candidates.push({
        saveId: row._id,
        saveName: row.saveName,
        saveVersion: row.saveVersion,
        revision: row.revision,
        contentHash: row.contentHash,
        createdAt: row.createdAt,
        validatorVersion: row.validatorVersion,
        content: content?.content ?? null,
      });
    }
    return { ok: true as const, totalCareers: new Set(rows.map((row) => row.saveName)).size, candidates };
  },
});

const migratedCareerValidator = v.object({
  saveId: v.id("freightFateSaves"),
  saveName: v.string(),
  revision: v.number(),
  contentHash: v.string(),
  validatorVersion: v.number(),
  acceptedAt: v.number(),
  fallbackOperationId: v.string(),
  achievementKeys: v.array(v.string()),
});

export const applyDriverMigration = internalMutation({
  args: {
    driverId: v.string(),
    migrationNow: v.number(),
    careers: v.array(migratedCareerValidator),
  },
  handler: async (ctx, args) => {
    // Recheck every input before the first write. A concurrent upload makes
    // this driver a clean retry instead of mixing two account states.
    for (const career of args.careers) {
      const row = await ctx.db.get(career.saveId);
      if (!row
        || row.driverId !== args.driverId
        || row.saveName !== career.saveName
        || row.revision !== career.revision
        || row.contentHash !== career.contentHash
        || row.validatorVersion !== career.validatorVersion
        || !row.sig || !row.keyId || !row.signedAt) {
        return { ok: false as const, reason: "career_changed" as const };
      }
    }

    let achievementsInserted = 0;
    let achievementsAlreadyPresent = 0;
    let fallbackOperationsInserted = 0;
    let fallbackOperationsAlreadyPresent = 0;
    const achievementKeys = new Set(args.careers.flatMap((career) => career.achievementKeys));

    // Bound and cache every remaining read before writing. Returning from a
    // preflight failure therefore leaves the driver's account untouched.
    const achievementsByKey = new Map<string, Array<Doc<"freightFateAchievements">>>();
    for (const achievementKey of achievementKeys) {
      const existing = await ctx.db.query("freightFateAchievements")
        .withIndex("by_driver_achievement", (q) =>
          q.eq("driverId", args.driverId).eq("achievementKey", achievementKey),
        ).take(MAX_DUPLICATE_ACHIEVEMENT_ROWS + 1);
      if (existing.length > MAX_DUPLICATE_ACHIEVEMENT_ROWS) {
        return { ok: false as const, reason: "achievement_row_limit" as const };
      }
      achievementsByKey.set(achievementKey, existing);
    }
    const meaningfulBySave = new Map<string, boolean>();
    for (const career of args.careers) {
      const existing = await ctx.db.query("freightFateMeaningfulPlayOperations")
        .withIndex("by_driver_save_accepted", (q) =>
          q.eq("driverId", args.driverId).eq("saveName", career.saveName),
        ).order("desc").first();
      meaningfulBySave.set(career.saveName, existing !== null);
    }

    for (const achievementKey of achievementKeys) {
      const existing = achievementsByKey.get(achievementKey) ?? [];
      if (existing.length === 0) {
        await ctx.db.insert("freightFateAchievements", {
          driverId: args.driverId,
          achievementKey,
          importSource: "verified_save",
          importedAt: args.migrationNow,
          createdAt: args.migrationNow,
        });
        achievementsInserted += 1;
        continue;
      }

      achievementsAlreadyPresent += 1;
      const keeper = [...existing].sort((a, b) =>
        (a.earnedAt ?? Number.POSITIVE_INFINITY) - (b.earnedAt ?? Number.POSITIVE_INFINITY)
        || a.createdAt - b.createdAt
        || String(a._id).localeCompare(String(b._id)),
      )[0];
      const earnedTimes = existing.flatMap((row) => row.earnedAt === undefined ? [] : [row.earnedAt]);
      const earliestEarnedAt = earnedTimes.length > 0 ? Math.min(...earnedTimes) : undefined;
      if (keeper.earnedAt !== earliestEarnedAt) {
        await ctx.db.patch(keeper._id, { earnedAt: earliestEarnedAt });
      }
      for (const duplicate of existing) {
        if (duplicate._id !== keeper._id) await ctx.db.delete(duplicate._id);
      }
    }

    for (const career of args.careers) {
      if (meaningfulBySave.get(career.saveName)) {
        fallbackOperationsAlreadyPresent += 1;
        continue;
      }
      await ctx.db.insert("freightFateMeaningfulPlayOperations", {
        driverId: args.driverId,
        operationId: career.fallbackOperationId,
        saveName: career.saveName,
        occurredAt: career.acceptedAt,
        acceptedAt: career.acceptedAt,
        reason: "changed_save",
      });
      fallbackOperationsInserted += 1;
    }

    return {
      ok: true as const,
      achievementsInserted,
      achievementsAlreadyPresent,
      fallbackOperationsInserted,
      fallbackOperationsAlreadyPresent,
    };
  },
});
