"use node";

import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  FREIGHT_FATE_ACHIEVEMENT_ID_SET,
} from "./freightFateProfileCatalog";
import {
  MAX_SHARED_PROFILE_BYTES,
  SHARED_PROFILE_VALIDATOR_VERSION,
  validateSharedProfile,
} from "./freightFateSharedProfileValidation";

const MAX_BATCH_DRIVERS = 10;

function previewGuardSatisfied(secret: string) {
  const configured = process.env.FREIGHT_FATE_PROFILE_MIGRATION_SECRET;
  if (process.env.FREIGHT_FATE_PROFILE_MIGRATION_MODE !== "preview" || !configured) return false;
  const suppliedBytes = Buffer.from(secret);
  const configuredBytes = Buffer.from(configured);
  return suppliedBytes.length === configuredBytes.length
    && timingSafeEqual(suppliedBytes, configuredBytes);
}

function decodeVerifiedCareer(candidate: {
  saveName: string;
  saveVersion: number;
  contentHash: string;
  content: ArrayBuffer;
}) {
  const bytes = Buffer.from(candidate.content);
  if (createHash("sha256").update(bytes).digest("hex") !== candidate.contentHash) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(gunzipSync(bytes, {
      maxOutputLength: MAX_SHARED_PROFILE_BYTES + 1,
    }).toString("utf8"));
  } catch {
    return null;
  }
  const validation = validateSharedProfile(payload, candidate.saveName);
  if (!validation.ok || validation.payload.version !== candidate.saveVersion) return null;
  return validation.payload;
}

export const runBatch = internalAction({
  args: {
    secret: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    if (!previewGuardSatisfied(args.secret)) {
      throw new Error("Freight Fate profile migration is preview-only");
    }
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_BATCH_DRIVERS) {
      throw new Error(`Migration batch limit must be between 1 and ${MAX_BATCH_DRIVERS}`);
    }

    const page = await ctx.runQuery(anyApi.freightFateProfileMigrationData.listDriverBatch, {
      paginationOpts: { cursor: args.cursor, numItems: args.limit },
    });
    const totals = {
      scannedDrivers: 0,
      scannedCareers: 0,
      achievementsInserted: 0,
      achievementsAlreadyPresent: 0,
      achievementsSkipped: 0,
      fallbackOperationsInserted: 0,
      fallbackOperationsAlreadyPresent: 0,
      fallbackOperationsSkipped: 0,
      skippedDrivers: 0,
      skippedCareers: 0,
      errors: 0,
    };

    for (const driver of page.page) {
      totals.scannedDrivers += 1;
      try {
        const read = await ctx.runQuery(
          anyApi.freightFateProfileMigrationData.readVerifiedCareerCandidates,
          { driverId: driver.driverId },
        );
        if (!read.ok) {
          totals.skippedDrivers += 1;
          totals.errors += 1;
          continue;
        }
        const careers = [];
        for (const candidate of read.candidates) {
          if (!candidate.content
            || candidate.validatorVersion !== SHARED_PROFILE_VALIDATOR_VERSION) {
            totals.skippedCareers += 1;
            totals.fallbackOperationsSkipped += 1;
            continue;
          }
          const payload = decodeVerifiedCareer({ ...candidate, content: candidate.content });
          if (!payload) {
            totals.skippedCareers += 1;
            totals.fallbackOperationsSkipped += 1;
            continue;
          }
          const canonical = (payload.achievements as string[])
            .filter((key) => FREIGHT_FATE_ACHIEVEMENT_ID_SET.has(key));
          totals.achievementsSkipped += (payload.achievements as string[]).length - canonical.length;
          totals.scannedCareers += 1;
          careers.push({
            saveId: candidate.saveId,
            saveName: candidate.saveName,
            revision: candidate.revision,
            contentHash: candidate.contentHash,
            validatorVersion: candidate.validatorVersion,
            acceptedAt: candidate.createdAt,
            fallbackOperationId: `profile-migration-v1:${createHash("sha256")
              .update(`${driver.driverId}\0${candidate.saveName}`, "utf8").digest("hex")}`,
            achievementKeys: canonical,
          });
        }
        totals.skippedCareers += Math.max(0, read.totalCareers - read.candidates.length);
        totals.fallbackOperationsSkipped += Math.max(0, read.totalCareers - read.candidates.length);
        if (careers.length === 0) continue;
        const applied = await ctx.runMutation(anyApi.freightFateProfileMigrationData.applyDriverMigration, {
          driverId: driver.driverId,
          migrationNow: Date.now(),
          careers,
        });
        if (!applied.ok) {
          totals.skippedDrivers += 1;
          totals.errors += 1;
          continue;
        }
        totals.achievementsInserted += applied.achievementsInserted;
        totals.achievementsAlreadyPresent += applied.achievementsAlreadyPresent;
        totals.fallbackOperationsInserted += applied.fallbackOperationsInserted;
        totals.fallbackOperationsAlreadyPresent += applied.fallbackOperationsAlreadyPresent;
      } catch {
        totals.skippedDrivers += 1;
        totals.errors += 1;
      }
    }

    return {
      ...totals,
      nextCursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
