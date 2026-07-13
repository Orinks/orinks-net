import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import { stampClientVersion } from "./freightFate";
import invariants from "../data/freight-fate-profile-invariants.json";

// --- Cloud saves for Freight Fate ---
//
// The desktop game mirrors each local save file (one per profile name) to a
// slot here. Auth is the same account-issued driver token used by presence
// and driver events: the REST layer hashes the Bearer token and the functions
// compare it against freightFateDrivers.driverTokenHash — the player never
// handles a second credential.
//
// Sync model is last-write-wins with a conflict guard: every upload names the
// revision it was based on, and a mismatch is rejected so the game can offer
// a spoken keep-cloud / keep-local choice instead of silently clobbering a
// newer save from another machine.

// Gzipped profile JSON is typically well under 100 KiB; the cap leaves the
// content document comfortably inside Convex's 1 MiB document limit.
export const MAX_SAVE_BYTES = 900 * 1024;
// Revisions kept per slot. Older revisions are pruned on upload; the history
// exists so a corrupted or regretted save can be rolled back.
export const KEEP_REVISIONS = 10;
// Distinct save names per driver. The game caps profiles well below this;
// the limit only stops a runaway or hostile client from filling the table.
export const MAX_SLOTS = 20;
export const SAVE_UPLOAD_LIMIT = 30;

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// Same digest as hashDriverToken in freightFate.ts, applied to save content:
// sha256 lowercase hex. The game computes the same hash before upload and
// after download, so a mismatch anywhere means the bytes were damaged in
// transit and the save is refused rather than restored corrupt.
async function sha256Hex(content: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", content);
  return toHex(new Uint8Array(digest));
}

async function authorizedDriver(ctx: QueryCtx, driverId: string, driverTokenHash: string) {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
    .unique();

  if (!driver) {
    return { driver: null, reason: "driver_not_found" as const };
  }

  if (driver.driverTokenHash !== driverTokenHash) {
    return { driver: null, reason: "unauthorized" as const };
  }

  return { driver, reason: null };
}

async function latestRevision(ctx: QueryCtx, driverId: string, saveName: string) {
  return ctx.db
    .query("freightFateSaves")
    .withIndex("by_slot", (q) => q.eq("driverId", driverId).eq("saveName", saveName))
    .order("desc")
    .first();
}

function levelForXp(xp: number) {
  const thresholds = invariants.levelXp as number[];
  let level = 1;
  for (let index = 1; index < thresholds.length; index += 1) {
    if (xp >= thresholds[index]) level = index + 1;
  }
  const extra = xp - thresholds[thresholds.length - 1];
  if (extra > 0) level = thresholds.length + Math.floor(extra / 1500);
  return level;
}

async function upsertVerifiedSnapshot(
  ctx: MutationCtx,
  args: { driverId: string; saveName: string; revision: number; payload: Record<string, unknown>; now: number; validatorVersion: number },
) {
  const career = args.payload.career as Record<string, number>;
  const level = levelForXp(career.xp);
  const cityLabels = invariants.cityLabels as Record<string, string>;
  const truckLabels = invariants.truckLabels as Record<string, string>;
  const truck = args.payload.truck as string;
  const clean = {
    driverId: args.driverId,
    version: 1,
    level,
    careerTitle: `Level ${level} driver`,
    lastSavedCity: cityLabels[args.payload.current_city as string],
    deliveries: career.deliveries,
    milesDriven: Math.round(career.total_miles * 10) / 10,
    reputation: Math.round(career.reputation * 10) / 10,
    onTimeDeliveries: career.on_time_deliveries,
    truckName: truckLabels[truck],
    employmentStatus: "Owner-operator",
    capturedAt: args.now,
    updatedAt: args.now,
    sourceSaveName: args.saveName,
    sourceRevision: args.revision,
    validatorVersion: args.validatorVersion,
  };
  const existing = await ctx.db.query("freightFateProfileSnapshots")
    .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
  if (existing) await ctx.db.patch(existing._id, clean);
  else await ctx.db.insert("freightFateProfileSnapshots", clean);
}

export const authorizeSaveAction = internalQuery({
  args: { driverId: v.string(), driverTokenHash: v.string() },
  handler: async (ctx, args) => {
    const { driver } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    return Boolean(driver);
  },
});

export const storeValidatedSave = internalMutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    saveName: v.string(),
    saveVersion: v.number(),
    // The cloud revision this upload was based on; null means the game has
    // never seen a cloud copy of this slot. Anything else than the current
    // latest revision is a conflict.
    parentRevision: v.union(v.number(), v.null()),
    contentHash: v.string(),
    content: v.bytes(),
    summary: v.string(),
    clientVersion: v.optional(v.string()),
    sig: v.string(),
    keyId: v.string(),
    signedAt: v.string(),
    validatorVersion: v.number(),
    payload: v.any(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();

    if (!driver) {
      return { ok: false as const, reason: "driver_not_found" as const };
    }

    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "save-upload",
      driverId: args.driverId,
      now: args.now,
      limit: SAVE_UPLOAD_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    if (driver.driverTokenHash !== args.driverTokenHash) {
      return { ok: false as const, reason: "unauthorized" as const };
    }

    await stampClientVersion(ctx, driver, args.clientVersion, args.now);

    if (args.content.byteLength === 0 || args.content.byteLength > MAX_SAVE_BYTES) {
      return { ok: false as const, reason: "too_large" as const };
    }

    if ((await sha256Hex(args.content)) !== args.contentHash) {
      return { ok: false as const, reason: "hash_mismatch" as const };
    }

    const latest = await latestRevision(ctx, args.driverId, args.saveName);

    if (!latest) {
      // New slot: enforce the per-driver slot cap before creating it.
      const rows = await ctx.db
        .query("freightFateSaves")
        .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
        .collect();
      const slots = new Set(rows.map((row) => row.saveName));
      if (slots.size >= MAX_SLOTS) {
        return { ok: false as const, reason: "too_many_slots" as const };
      }
    }

    const latestRev = latest?.revision ?? null;
    if (args.parentRevision !== latestRev) {
      return {
        ok: false as const,
        reason: "conflict" as const,
        latestRevision: latestRev,
        latestCreatedAt: latest?.createdAt ?? null,
        latestSummary: latest?.summary ?? null,
      };
    }

    const revision = (latest?.revision ?? 0) + 1;
    const contentId = await ctx.db.insert("freightFateSaveContent", {
      driverId: args.driverId,
      content: args.content,
    });
    await ctx.db.insert("freightFateSaves", {
      driverId: args.driverId,
      saveName: args.saveName,
      revision,
      saveVersion: args.saveVersion,
      contentHash: args.contentHash,
      sizeBytes: args.content.byteLength,
      summary: args.summary,
      contentId,
      sig: args.sig,
      keyId: args.keyId,
      signedAt: args.signedAt,
      validatorVersion: args.validatorVersion,
      createdAt: args.now,
    });

    await upsertVerifiedSnapshot(ctx, {
      driverId: args.driverId,
      saveName: args.saveName,
      revision,
      payload: args.payload as Record<string, unknown>,
      now: args.now,
      validatorVersion: args.validatorVersion,
    });

    // Prune revisions beyond the keep window, oldest first, content included.
    const keepAbove = revision - KEEP_REVISIONS;
    if (keepAbove > 0) {
      const stale = await ctx.db
        .query("freightFateSaves")
        .withIndex("by_slot", (q) =>
          q.eq("driverId", args.driverId).eq("saveName", args.saveName).lte("revision", keepAbove),
        )
        .collect();
      for (const row of stale) {
        await ctx.db.delete(row.contentId);
        await ctx.db.delete(row._id);
      }
    }

    return { ok: true as const, revision };
  },
});

export const readSaveForAction = internalQuery({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    saveName: v.string(),
    revision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { driver, reason } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) return { ok: false as const, reason };
    const row = args.revision === undefined
      ? await latestRevision(ctx, args.driverId, args.saveName)
      : await ctx.db.query("freightFateSaves").withIndex("by_slot", (q) =>
          q.eq("driverId", args.driverId).eq("saveName", args.saveName).eq("revision", args.revision!),
        ).unique();
    if (!row) return { ok: false as const, reason: "save_not_found" as const };
    const content = await ctx.db.get(row.contentId);
    if (!content) return { ok: false as const, reason: "save_not_found" as const };
    return { ok: true as const, row, content: content.content };
  },
});

export const attachLegacySignature = internalMutation({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), saveId: v.id("freightFateSaves"),
    sig: v.string(), keyId: v.string(), signedAt: v.string(), validatorVersion: v.number(),
    payload: v.any(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const { driver } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) return { ok: false as const, reason: "unauthorized" as const };
    const row = await ctx.db.get(args.saveId);
    if (!row || row.driverId !== args.driverId) return { ok: false as const, reason: "save_not_found" as const };
    await ctx.db.patch(row._id, {
      sig: args.sig, keyId: args.keyId, signedAt: args.signedAt, validatorVersion: args.validatorVersion,
    });
    await upsertVerifiedSnapshot(ctx, {
      driverId: args.driverId, saveName: row.saveName, revision: row.revision,
      payload: args.payload as Record<string, unknown>, now: args.now,
      validatorVersion: args.validatorVersion,
    });
    return { ok: true as const };
  },
});

export const listSaves = query({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { driver, reason } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) {
      return { ok: false as const, reason };
    }

    const rows = await ctx.db
      .query("freightFateSaves")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .collect();

    rows.sort((a, b) => b.createdAt - a.createdAt);

    return {
      ok: true as const,
      saves: rows.map((row) => ({
        saveName: row.saveName,
        revision: row.revision,
        saveVersion: row.saveVersion,
        contentHash: row.contentHash,
        sizeBytes: row.sizeBytes,
        summary: row.summary,
        createdAt: row.createdAt,
      })),
    };
  },
});

export const deleteSaveSlot = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    saveName: v.string(),
  },
  handler: async (ctx, args) => {
    const { driver, reason } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) {
      return { ok: false as const, reason };
    }

    const rows = await ctx.db
      .query("freightFateSaves")
      .withIndex("by_slot", (q) => q.eq("driverId", args.driverId).eq("saveName", args.saveName))
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row.contentId);
      await ctx.db.delete(row._id);
    }

    const snapshot = await ctx.db
      .query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (snapshot?.sourceSaveName === args.saveName) {
      await ctx.db.delete(snapshot._id);
    }

    return { ok: true as const, deletedRevisions: rows.length };
  },
});
