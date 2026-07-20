"use node";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { anyApi } from "convex/server";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { signSharedProfile } from "./freightFateSharedProfileSigning";
import {
  MAX_SHARED_PROFILE_BYTES,
  SHARED_PROFILE_VALIDATOR_VERSION,
  validateSharedProfile,
} from "./freightFateSharedProfileValidation";

function signingConfig() {
  const privateKey = process.env.FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY;
  const keyId = process.env.FREIGHT_FATE_PROFILE_SIGNING_KEY_ID;
  if (!privateKey || !keyId || !/^\d{4}-\d{2}(?:-[a-z0-9-]+)?$/.test(keyId)) return null;
  return { privateKey, keyId };
}

function decodeAndValidate(content: ArrayBuffer, saveName: string, expectedHash: string) {
  const bytes = Buffer.from(content);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
    return { ok: false as const, reason: "hash_mismatch" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(gunzipSync(bytes, {
      maxOutputLength: MAX_SHARED_PROFILE_BYTES + 1,
    }).toString("utf8"));
  } catch {
    return { ok: false as const, reason: "invalid_schema" };
  }
  const validation = validateSharedProfile(payload, saveName);
  if (!validation.ok) return validation;
  return { ok: true as const, payload: validation.payload };
}

function signPayload(payload: Record<string, unknown>, now: number) {
  const config = signingConfig();
  if (!config) return null;
  try {
    return {
      sig: signSharedProfile(payload, config.privateKey),
      keyId: config.keyId,
      signedAt: new Date(now).toISOString(),
      validatorVersion: SHARED_PROFILE_VALIDATOR_VERSION,
    };
  } catch {
    return null;
  }
}

export const uploadValidatedSave = action({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), saveName: v.string(),
    saveVersion: v.number(), parentRevision: v.union(v.number(), v.null()),
    contentHash: v.string(), content: v.bytes(), summary: v.string(),
    clientVersion: v.optional(v.string()), now: v.number(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const authorized = await ctx.runQuery(anyApi.freightFateSaves.authorizeSaveAction, {
      driverId: args.driverId, driverTokenHash: args.driverTokenHash,
    });
    if (!authorized) return { ok: false, reason: "unauthorized" };
    const validation = decodeAndValidate(args.content, args.saveName, args.contentHash);
    if (!validation.ok) {
      // Only the self-contradicting arithmetic reasons are cheat evidence;
      // damaged or outdated uploads are rejected without a verdict.
      if (validation.reason === "impossible_money" || validation.reason === "impossible_xp") {
        await ctx.runMutation(anyApi.freightFateSaves.stampIntegrityFromValidation, {
          driverId: args.driverId,
          driverTokenHash: args.driverTokenHash,
          reason: validation.reason,
          now: args.now,
        });
      }
      return { ok: false, reason: validation.reason };
    }
    if (validation.payload.version !== args.saveVersion) {
      return { ok: false, reason: "unsupported_version" };
    }
    // A profile marked modified is a risk signal, never a verdict: the same
    // mark is raised by copying a career to a second computer, which is
    // honest. It has already been through the full gate above -- nothing here
    // samples or shortcuts -- so record that it passed and let it through.
    // Absolution rides the next verified download (see downloadValidatedSave).
    if (validation.payload.integrity_modified === true) {
      console.warn(
        `Freight Fate: modified-marked profile passed validation for driver ${args.driverId}` +
        ` (build ${args.clientVersion ?? "unknown"}, save "${args.saveName}").`,
      );
    }
    const signed = signPayload(validation.payload, args.now);
    if (!signed) return { ok: false, reason: "signing_unavailable" };
    return ctx.runMutation(anyApi.freightFateSaves.storeValidatedSave, {
      ...args,
      ...signed,
      payload: validation.payload,
    });
  },
});

// One-time repair for drivers hidden by the validator rollout: re-validate
// each unverified snapshot's newest stored revision and stamp it (see
// freightFateSaves.listBackfillTargets). Run from the CLI:
//   npx convex run freightFateSaveActions:backfillVerifiedSnapshots '{"now": <ms>}' --prod
export const backfillVerifiedSnapshots = internalAction({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<Array<Record<string, unknown>>> => {
    const targets: Array<{ saveId: string }> = await ctx.runQuery(
      anyApi.freightFateSaves.listBackfillTargets,
      {},
    );
    const report: Array<Record<string, unknown>> = [];
    for (const target of targets) {
      const stored = await ctx.runQuery(anyApi.freightFateSaves.readSaveForBackfill, {
        saveId: target.saveId,
      });
      if (!stored) {
        report.push({ saveId: target.saveId, ok: false, reason: "save_not_found" });
        continue;
      }
      const validation = decodeAndValidate(
        stored.content,
        stored.row.saveName,
        stored.row.contentHash,
      );
      if (!validation.ok) {
        report.push({ driverId: stored.row.driverId, ok: false, reason: validation.reason });
        continue;
      }
      if (validation.payload.version !== stored.row.saveVersion) {
        report.push({ driverId: stored.row.driverId, ok: false, reason: "unsupported_version" });
        continue;
      }
      const signed = signPayload(validation.payload, args.now);
      if (!signed) {
        report.push({ driverId: stored.row.driverId, ok: false, reason: "signing_unavailable" });
        continue;
      }
      const stamped = await ctx.runMutation(anyApi.freightFateSaves.stampBackfilledSnapshot, {
        saveId: target.saveId,
        ...signed,
        payload: validation.payload,
      });
      report.push({
        driverId: stored.row.driverId,
        revision: stored.row.revision,
        ...stamped,
      });
    }
    return report;
  },
});

export const downloadValidatedSave = action({
  args: {
    driverId: v.string(), driverTokenHash: v.string(), saveName: v.string(),
    revision: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const result = await ctx.runQuery(anyApi.freightFateSaves.readSaveForAction, {
      driverId: args.driverId,
      driverTokenHash: args.driverTokenHash,
      saveName: args.saveName,
      revision: args.revision,
    });
    if (!result.ok) return result;
    const validation = decodeAndValidate(result.content, result.row.saveName, result.row.contentHash);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    let signed = result.row.sig && result.row.keyId && result.row.signedAt && result.row.validatorVersion
      ? {
          sig: result.row.sig,
          keyId: result.row.keyId,
          signedAt: result.row.signedAt,
          validatorVersion: result.row.validatorVersion,
        }
      : signPayload(validation.payload, args.now);
    if (!signed) return { ok: false, reason: "signing_unavailable" };
    if (!result.row.sig) {
      const attached = await ctx.runMutation(anyApi.freightFateSaves.attachLegacySignature, {
        driverId: args.driverId, driverTokenHash: args.driverTokenHash, saveId: result.row._id,
        ...signed, payload: validation.payload, now: args.now,
      });
      if (!attached.ok) return attached;
    }
    // Absolution. This profile carries the client's "changed outside the
    // game" mark and has just passed the full gate on a signed revision --
    // the only place the signal is allowed to ride. Tell the client to clear
    // the mark, so moving a career to a second computer stops branding it
    // forever. A profile that fails validation never reaches this line.
    const absolve = validation.payload.integrity_modified === true;
    return {
      ok: true,
      saveName: result.row.saveName,
      revision: result.row.revision,
      saveVersion: result.row.saveVersion,
      contentHash: result.row.contentHash,
      sizeBytes: result.row.sizeBytes,
      summary: result.row.summary,
      createdAt: result.row.createdAt,
      content: result.content,
      ...(absolve ? { clearIntegrityFlag: true } : {}),
      ...signed,
    };
  },
});
