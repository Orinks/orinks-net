import { createHash } from "node:crypto";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";

export type FreightFateVisibility = "public" | "private" | "unlisted";

export function hashFreightFateToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeFreightFateDriverId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Driver ID is required.");
  }

  const driverId = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  if (driverId.length < 8) {
    throw new Error("Driver ID is too short.");
  }

  return driverId;
}

export function normalizeFreightFateDisplayName(value: unknown, fallback = "Freight Fate Driver") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 48) || fallback;
}

export function normalizeFreightFateVisibility(value: unknown): FreightFateVisibility {
  if (value === "public" || value === "unlisted") {
    return value;
  }
  return "private";
}

export function normalizeFreightFateToken(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} is required.`);
  }

  const token = value.trim();

  if (token.length < 24 || token.length > 512) {
    throw new Error(`${label} must be between 24 and 512 characters.`);
  }

  return token;
}

export function normalizeFreightFateEventText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new Error(`${label} is required.`);
  }

  const text = value.trim().replace(/\s+/g, " ");

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  return text.slice(0, maxLength);
}

// Mirrors the game's profile-filename sanitizer (alnum, space, dash,
// underscore) so a slot name round-trips between the local file and the
// cloud slot unchanged.
export function normalizeFreightFateSaveName(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Save name is required.");
  }

  const saveName = value
    .trim()
    .replace(/[^A-Za-z0-9 _-]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 64);

  if (!saveName) {
    throw new Error("Save name is required.");
  }

  return saveName;
}

// Matches MAX_SAVE_BYTES in convex/freightFateSaves.ts; checked here first so
// an oversized upload fails with a clear 413 before reaching Convex.
export const FREIGHT_FATE_MAX_SAVE_BYTES = 900 * 1024;

export function decodeFreightFateSaveContent(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Save content is required.");
  }

  const bytes = Buffer.from(value, "base64");
  // Reject strings that are not valid base64 rather than silently storing
  // whatever Buffer salvaged from them.
  if (bytes.length === 0 || Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("Save content must be base64.");
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function postFreightFateSave(input: {
  driverId: string;
  driverToken: string;
  saveName: string;
  saveVersion: number;
  parentRevision: number | null;
  contentHash: string;
  content: ArrayBuffer;
  summary: string;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.freightFateSaves.uploadSave, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: normalizeFreightFateSaveName(input.saveName),
    saveVersion: input.saveVersion,
    parentRevision: input.parentRevision,
    contentHash: input.contentHash,
    content: input.content,
    summary: input.summary.trim().replace(/\s+/g, " ").slice(0, 160),
    now: Date.now(),
  });
}

export async function listFreightFateSaves(input: { driverId: string; driverToken: string }) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFateSaves.listSaves, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
  });
}

export async function downloadFreightFateSave(input: {
  driverId: string;
  driverToken: string;
  saveName: string;
  revision?: number;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFateSaves.downloadSave, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: normalizeFreightFateSaveName(input.saveName),
    ...(input.revision === undefined ? {} : { revision: input.revision }),
  });
}

export async function postFreightFateDriverEvent(input: {
  driverId: string;
  driverToken: string;
  eventId: string;
  eventType: string;
  summary: string;
  occurredAt?: number;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  const now = Date.now();

  return client.mutation(anyApi.freightFate.recordDriverEvent, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    eventId: normalizeFreightFateEventText(input.eventId, "Event ID", 96),
    eventType: normalizeFreightFateEventText(input.eventType, "Event type", 48),
    summary: normalizeFreightFateEventText(input.summary, "Summary", 280),
    occurredAt: input.occurredAt ?? now,
    now,
  });
}

export async function postFreightFatePresence(input: {
  driverId: string;
  driverToken: string;
  activity: string;
  detail: string;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.freightFate.updatePresence, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    // An empty activity means "going off duty"; keep it empty rather than
    // letting the normalizer reject it.
    activity: input.activity.trim().replace(/\s+/g, " ").slice(0, 160),
    detail: input.detail.trim().replace(/\s+/g, " ").slice(0, 160),
    now: Date.now(),
  });
}

export type FreightFatePresenceBoard = {
  drivers: {
    driverId: string;
    displayName: string;
    activity: string;
    detail: string;
    updatedAt: number;
  }[];
  asOf: number;
};

export async function getFreightFatePresenceBoard(): Promise<FreightFatePresenceBoard | null> {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFate.getPresenceBoard, { now: Date.now() });
}

export async function getFreightFateDriverProfile(driverId: string, limit = 20) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFate.getDriverProfile, {
    driverId: normalizeFreightFateDriverId(driverId),
    limit,
  });
}
