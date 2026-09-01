import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { KEEP_REVISIONS } from "./freightFateSaves";

// Before rolling ten-career retention, cloud sync accepted up to twenty
// distinct career slots. Keep that historical ceiling here so a legitimate
// legacy account can be prepared without turning this into an unbounded scan.
const MAX_LEGACY_SLOTS = 20;
const MAX_DRIVER_REVISIONS = MAX_LEGACY_SLOTS * KEEP_REVISIONS;
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

    const candidates = rows
      .filter((row) => Boolean(row.sig && row.keyId && row.signedAt && row.validatorVersion))
      .sort((a, b) => a.saveName.localeCompare(b.saveName) || b.revision - a.revision)
      .map((row) => ({
        saveId: row._id,
        saveName: row.saveName,
        saveVersion: row.saveVersion,
        revision: row.revision,
        contentHash: row.contentHash,
        createdAt: row.createdAt,
        validatorVersion: row.validatorVersion,
      }));
    const latestByCareer = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const prior = latestByCareer.get(row.saveName);
      if (!prior || row.revision > prior.revision) latestByCareer.set(row.saveName, row);
    }
    return {
      ok: true as const,
      totalCareers: latestByCareer.size,
      observedRevisionCount: rows.length,
      observedHeads: [...latestByCareer.values()].map((row) => ({
        saveId: row._id,
        saveName: row.saveName,
        revision: row.revision,
        contentHash: row.contentHash,
      })),
      candidates,
    };
  },
});

export const readCandidateContent = internalQuery({
  args: { saveId: v.id("freightFateSaves") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.saveId);
    if (!row) return null;
    const content = await ctx.db.get(row.contentId);
    return content?.content ?? null;
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

const observedHeadValidator = v.object({
  saveId: v.id("freightFateSaves"),
  saveName: v.string(),
  revision: v.number(),
  contentHash: v.string(),
});

export const applyDriverMigration = internalMutation({
  args: {
    driverId: v.string(),
    migrationNow: v.number(),
    observedRevisionCount: v.number(),
    observedHeads: v.array(observedHeadValidator),
    careers: v.array(migratedCareerValidator),
  },
  handler: async (ctx, args) => {
    // Recheck every input before the first write. A concurrent upload makes
    // this driver a clean retry instead of mixing two account states.
    const currentRows = await ctx.db.query("freightFateSaves")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .take(MAX_DRIVER_REVISIONS + 1);
    if (currentRows.length !== args.observedRevisionCount) {
      return { ok: false as const, reason: "career_changed" as const };
    }
    for (const head of args.observedHeads) {
      const current = await ctx.db.query("freightFateSaves")
        .withIndex("by_slot", (q) =>
          q.eq("driverId", args.driverId).eq("saveName", head.saveName),
        ).order("desc").first();
      if (!current
        || current._id !== head.saveId
        || current.revision !== head.revision
        || current.contentHash !== head.contentHash) {
        return { ok: false as const, reason: "career_changed" as const };
      }
    }
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
