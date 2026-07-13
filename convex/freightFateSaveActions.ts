"use node";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { anyApi } from "convex/server";
import { action } from "./_generated/server";
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
    if (!validation.ok) return { ok: false, reason: validation.reason };
    if (validation.payload.version !== args.saveVersion) {
      return { ok: false, reason: "unsupported_version" };
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
      ...signed,
    };
  },
});
