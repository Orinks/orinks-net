import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import {
  acceptDriverToken,
  driverTokenAccepted,
  freightFateProfileLinkVisible,
  stampClientVersion,
  stampDeviceTokenUse,
} from "./freightFate";
import { buildVerifiedProfileSnapshot } from "./freightFateProfileProjection";
import { meaningfulPlayValidator } from "./freightFateMeaningfulPlay";
import { freightFateSaveSlotName } from "../lib/freight-fate-save-name";

// --- Cloud saves for Freight Fate ---
//
// The desktop game mirrors each local save file (one per profile name) to a
// slot here. Auth is the same account-issued driver token used by presence
// and driver events: the REST layer hashes the Bearer token and the functions
// accept any of the driver's tokens (driverTokenAccepted in freightFate.ts)
// — the player never handles a second credential.
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
export const MAX_SLOTS = 10;
export const SAVE_UPLOAD_LIMIT = 30;
const MAX_RETENTION_OPERATIONS_PER_SLOT = 100;

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

  if (!(await driverTokenAccepted(ctx, driver, driverTokenHash))) {
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

function retentionName(saveName: string) {
  return freightFateSaveSlotName(saveName).normalize("NFKC").toLowerCase();
}

async function planRetentionEviction(
  ctx: MutationCtx,
  args: { driverId: string; incomingSaveName: string; publicSaveName?: string },
) {
  // Ten slots times ten retained revisions is the largest healthy account.
  // One extra row means the invariant is already broken, so a new career
  // cannot safely decide which complete slot history it would replace.
  const rows = await ctx.db
    .query("freightFateSaves")
    .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
    .take(MAX_SLOTS * KEEP_REVISIONS + 1);
  if (rows.length > MAX_SLOTS * KEEP_REVISIONS) return null;

  const latestBySave = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const previous = latestBySave.get(row.saveName);
    if (!previous || row.revision > previous.revision) latestBySave.set(row.saveName, row);
  }
  if (latestBySave.size < MAX_SLOTS) return undefined;
  if (latestBySave.size !== MAX_SLOTS) return null;

  const candidates = [];
  for (const [saveName, latest] of latestBySave) {
    if (saveName === args.incomingSaveName || saveName === args.publicSaveName) continue;
    const meaningful = await ctx.db
      .query("freightFateMeaningfulPlayOperations")
      .withIndex("by_driver_save_accepted", (q) =>
        q.eq("driverId", args.driverId).eq("saveName", saveName),
      )
      .order("desc")
      .first();
    candidates.push({
      saveName,
      rankingTime: meaningful?.acceptedAt ?? latest.createdAt,
      normalizedName: retentionName(saveName),
    });
  }
  candidates.sort((a, b) =>
    a.rankingTime - b.rankingTime
    || (a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0)
    || (a.saveName < b.saveName ? -1 : a.saveName > b.saveName ? 1 : 0),
  );
  const selected = candidates[0];
  if (!selected) return null;

  const saveRows = rows.filter((row) => row.saveName === selected.saveName);
  for (const row of saveRows) {
    if (!(await ctx.db.get(row.contentId))) return null;
  }
  const operationRows = await ctx.db
    .query("freightFateMeaningfulPlayOperations")
    .withIndex("by_driver_save_accepted", (q) =>
      q.eq("driverId", args.driverId).eq("saveName", selected.saveName),
    )
    .take(MAX_RETENTION_OPERATIONS_PER_SLOT + 1);
  if (operationRows.length > MAX_RETENTION_OPERATIONS_PER_SLOT) return null;
  const snapshot = await ctx.db
    .query("freightFateProfileSnapshots")
    .withIndex("by_driver", (q) => q.eq("driverId", args.driverId))
    .unique();

  return {
    saveName: selected.saveName,
    saveRows,
    operationRows,
    snapshot: snapshot?.sourceSaveName === selected.saveName ? snapshot : undefined,
  };
}

async function upsertVerifiedSnapshot(
  ctx: MutationCtx,
  args: {
    driverId: string;
    saveName: string;
    revision: number;
    payload: Record<string, unknown>;
    now: number;
    validatorVersion: number;
    selection?: "legacy" | "meaningful";
  },
) {
  const selection = args.selection ?? "legacy";
  const clean = buildVerifiedProfileSnapshot({
    ...args,
    ...(selection === "meaningful" ? { meaningfulPlayedAt: args.now } : {}),
  });
  const existing = await ctx.db.query("freightFateProfileSnapshots")
    .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
  // A player-designated public career (setPublicSave) decides outright which
  // slot may project. Without one, the first verified slot owns the
  // projection until that slot is deleted -- uploading a different career
  // must not silently replace the driver's chosen public identity. Legacy
  // rows without an owner are claimed by the first verified upload.
  const owner = await ctx.db.query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId)).unique();
  if (owner?.publicSaveName !== undefined) {
    if (args.saveName !== owner.publicSaveName) return;
  } else if (existing?.sourceSaveName && existing.sourceSaveName !== args.saveName) {
    return;
  }
  if (existing) {
    // The first verified slot owns the public projection until that slot is
    // deleted. Uploading a different career must not silently replace the
    // driver's chosen public identity. Legacy rows without an owner are
    // claimed by the first verified upload that reaches them.
    if (selection === "legacy"
      && existing.sourceSaveName && existing.sourceSaveName !== args.saveName) return;
    // Replace rather than patch: optional facts that disappear from a later
    // verified save (for example a now-unpriced trailer) must be removed,
    // never inherited from the previously selected career.
    await ctx.db.replace(existing._id, clean);
  } else {
    await ctx.db.insert("freightFateProfileSnapshots", clean);
  }
}

// One career is the driver's public face; the rest are private cloud
// backups. Chosen from the game's Cloud backup menu. Designating a career
// other than the current projection's source drops the projection at once --
// the player just said it is not their public identity -- and the designated
// career's next accepted backup rebuilds it. null returns to the
// first-uploader rule above.
export const setPublicSave = mutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    saveName: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { driver, reason } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) {
      return { ok: false as const, reason };
    }
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "public-save", driverId: args.driverId, now: args.now, limit: 12,
    });
    if (!allowed) {
      return { ok: false as const, reason: "rate_limited" as const };
    }
    if (args.saveName !== null && (args.saveName.length === 0 || args.saveName.length > 48)) {
      return { ok: false as const, reason: "invalid_name" as const };
    }
    await ctx.db.patch(driver._id, {
      publicSaveName: args.saveName ?? undefined,
      updatedAt: args.now,
    });
    if (args.saveName !== null) {
      const snapshot = await ctx.db.query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", args.driverId)).unique();
      if (snapshot && snapshot.sourceSaveName !== args.saveName) {
        await ctx.db.delete(snapshot._id);
      }
    }
    return { ok: true as const, publicSaveName: args.saveName };
  },
});

async function mergeVerifiedAchievements(
  ctx: MutationCtx,
  driverId: string,
  payload: Record<string, unknown>,
  now: number,
) {
  for (const achievementKey of payload.achievements as string[]) {
    const existing = await ctx.db.query("freightFateAchievements")
      .withIndex("by_driver_achievement", (q) =>
        q.eq("driverId", driverId).eq("achievementKey", achievementKey),
      ).unique();
    if (existing) continue;
    await ctx.db.insert("freightFateAchievements", {
      driverId,
      achievementKey,
      importSource: "verified_save",
      importedAt: now,
      createdAt: now,
    });
  }
}

export const authorizeSaveAction = internalQuery({
  args: { driverId: v.string(), driverTokenHash: v.string() },
  handler: async (ctx, args) => {
    const { driver } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    return Boolean(driver);
  },
});

// How long a rejected upload's payload is kept for review. Long enough to
// notice a pattern and audit it by hand, short enough that a rejected career
// is not archived indefinitely.
export const REJECTED_UPLOAD_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Rows deleted per prune pass. These carry a full save payload each, so the
// batch stays small: a backlog drains over several ticks rather than one long
// transaction.
export const REJECTED_UPLOAD_PRUNE_BATCH = 50;

// Keep the payload behind an arithmetic rejection (money the career never
// earned, XP the miles cannot support) so the verdict can be checked later.
// Schema, hash, and version failures never land here — they are sync skew, not
// evidence of anything.
//
// This replaced stampIntegrityFromValidation, which branded the driver row
// instead. Both arithmetic rules were wrong in the accusing direction, the
// brand was sticky and hid the player until a human cleared it, and the
// payload that triggered it was thrown away — so the single flag it raised in
// production could not be reviewed at all. Rejecting the upload is the
// enforcement; conviction is a human call made against these rows.
export const recordRejectedUpload = internalMutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    reason: v.string(),
    saveName: v.string(),
    saveVersion: v.number(),
    contentHash: v.string(),
    content: v.bytes(),
    clientVersion: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { driver } = await authorizedDriver(ctx, args.driverId, args.driverTokenHash);
    if (!driver) return;
    // One row per driver per distinct payload: a game that retries the same
    // rejected save must not be able to grow the table. Look the hash up
    // through its own index rather than scanning this driver's rows -- each
    // row carries a whole save, so a scan made the cost of rejecting one
    // upload grow with every upload already rejected, and a driver rejected
    // often enough would eventually blow the transaction read limit and stop
    // producing the evidence these rows exist to keep.
    const seen = await ctx.db
      .query("freightFateRejectedUploads")
      .withIndex("by_driver_content", (q) =>
        q.eq("driverId", args.driverId).eq("contentHash", args.contentHash),
      )
      .first();
    if (seen) return;
    await ctx.db.insert("freightFateRejectedUploads", {
      driverId: args.driverId,
      reason: args.reason.slice(0, 32),
      saveName: args.saveName,
      saveVersion: args.saveVersion,
      contentHash: args.contentHash,
      content: args.content,
      clientVersion: args.clientVersion,
      rejectedAt: args.now,
    });
  },
});

// Drop retained payloads past the review window. Internal only:
// Runs on a cron; returns how much it removed so a backlog is visible in the
// logs. Also runnable by hand:
//
//   npx convex run freightFateSaves:pruneRejectedUploads --prod
export const pruneRejectedUploads = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - REJECTED_UPLOAD_TTL_MS;
    const stale = await ctx.db
      .query("freightFateRejectedUploads")
      .withIndex("by_rejected_at", (q) => q.lt("rejectedAt", cutoff))
      .take(REJECTED_UPLOAD_PRUNE_BATCH);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    // A full batch means more was waiting than one pass can take; the next
    // tick continues from there.
    return {
      deleted: stale.length,
      moreWaiting: stale.length === REJECTED_UPLOAD_PRUNE_BATCH,
    };
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
    meaningfulPlay: v.optional(v.union(v.null(), meaningfulPlayValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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
      now,
      limit: SAVE_UPLOAD_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    const { accepted, device } = await acceptDriverToken(ctx, driver, args.driverTokenHash);
    if (!accepted) {
      return { ok: false as const, reason: "unauthorized" as const };
    }

    await stampClientVersion(ctx, driver, args.clientVersion, now);
    await stampDeviceTokenUse(ctx, device, now);

    if (args.content.byteLength === 0 || args.content.byteLength > MAX_SAVE_BYTES) {
      return { ok: false as const, reason: "too_large" as const };
    }

    if ((await sha256Hex(args.content)) !== args.contentHash) {
      return { ok: false as const, reason: "hash_mismatch" as const };
    }

    const latest = await latestRevision(ctx, args.driverId, args.saveName);

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

    const eviction = latest
      ? undefined
      : await planRetentionEviction(ctx, {
          driverId: args.driverId,
          incomingSaveName: args.saveName,
          publicSaveName: driver.publicSaveName,
        });
    if (eviction === null) {
      return { ok: false as const, reason: "retention_blocked" as const };
    }
    if (eviction) {
      for (const row of eviction.saveRows) {
        await ctx.db.delete(row.contentId);
        await ctx.db.delete(row._id);
      }
      for (const operation of eviction.operationRows) {
        await ctx.db.delete(operation._id);
      }
      if (eviction.snapshot) await ctx.db.delete(eviction.snapshot._id);
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
      createdAt: now,
    });

    const payload = args.payload as Record<string, unknown>;
    await mergeVerifiedAchievements(ctx, args.driverId, payload, now);

    let acceptedMeaningful = false;
    if (args.meaningfulPlay) {
      const existingOperation = await ctx.db.query("freightFateMeaningfulPlayOperations")
        .withIndex("by_driver_operation", (q) =>
          q.eq("driverId", args.driverId).eq("operationId", args.meaningfulPlay!.operationId),
        ).unique();
      if (!existingOperation) {
        await ctx.db.insert("freightFateMeaningfulPlayOperations", {
          driverId: args.driverId,
          operationId: args.meaningfulPlay.operationId,
          saveName: args.saveName,
          occurredAt: args.meaningfulPlay.occurredAt,
          reason: args.meaningfulPlay.reason,
          acceptedAt: now,
        });
        acceptedMeaningful = true;
      }
    }

    // Old clients still store cloud revisions, but omitted intent cannot
    // create, select, or refresh a shared career. Only a new operation may
    // do that, and only while the profile remains link-visible.
    if (acceptedMeaningful && freightFateProfileLinkVisible(driver)) {
      await ctx.db.patch(driver._id, { publicSaveName: args.saveName, updatedAt: now });
      await upsertVerifiedSnapshot(ctx, {
        driverId: args.driverId, saveName: args.saveName, revision,
        payload, now, validatorVersion: args.validatorVersion,
        selection: "meaningful",
      });
    }

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

    return {
      ok: true as const,
      revision,
      ...(eviction ? { evictedSaveName: eviction.saveName } : {}),
    };
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

// --- One-time backfill: verify snapshots from pre-validator uploads ---
//
// Drivers whose latest accepted upload predates the shared-profile validator
// have snapshot rows without sourceRevision/validatorVersion, which the
// public profile hides. The backfill re-validates each such driver's newest
// stored revision under the current rules and stamps both the revision's
// signature and the snapshot, so those drivers reappear without having to
// upload again. Trigger via freightFateSaveActions.backfillVerifiedSnapshots.

export const listBackfillTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const snapshots = await ctx.db.query("freightFateProfileSnapshots").collect();
    const targets: Array<{ saveId: string }> = [];
    for (const snapshot of snapshots) {
      if (snapshot.validatorVersion) continue;
      const rows = await ctx.db
        .query("freightFateSaves")
        .withIndex("by_driver", (q) => q.eq("driverId", snapshot.driverId))
        .collect();
      rows.sort((a, b) => b.createdAt - a.createdAt);
      if (rows[0]) targets.push({ saveId: rows[0]._id });
    }
    return targets;
  },
});

export const readSaveForBackfill = internalQuery({
  args: { saveId: v.id("freightFateSaves") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.saveId);
    if (!row) return null;
    const content = await ctx.db.get(row.contentId);
    if (!content) return null;
    return { row, content: content.content };
  },
});

export const stampBackfilledSnapshot = internalMutation({
  args: {
    saveId: v.id("freightFateSaves"),
    sig: v.string(),
    keyId: v.string(),
    signedAt: v.string(),
    validatorVersion: v.number(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.saveId);
    if (!row) return { ok: false as const, reason: "save_not_found" as const };
    if (!row.sig) {
      await ctx.db.patch(row._id, {
        sig: args.sig,
        keyId: args.keyId,
        signedAt: args.signedAt,
        validatorVersion: args.validatorVersion,
      });
    }
    await upsertVerifiedSnapshot(ctx, {
      driverId: row.driverId,
      saveName: row.saveName,
      revision: row.revision,
      payload: args.payload as Record<string, unknown>,
      // The snapshot reflects when that revision was actually accepted, not
      // when the backfill ran.
      now: row.createdAt,
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
      // Which career fronts the public profile (null = first-uploader rule),
      // so the game's menu can say it without a second request.
      publicSaveName: driver.publicSaveName ?? null,
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
    if (driver.publicSaveName === args.saveName) {
      await ctx.db.patch(driver._id, { publicSaveName: undefined });
    }

    return { ok: true as const, deletedRevisions: rows.length };
  },
});
