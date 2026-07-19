import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { freightFateSaveSlotName } from "./freight-fate-save-name";
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

// The game stamps every request's User-Agent as "FreightFate/<build>", where
// <build> is the packaged build tag ("v1.8.0", "nightly-20260711") or
// "source-<version>" for source checkouts. Builds from before the stamp send
// a bare "FreightFate", and anything else (curl, a browser) matches nothing;
// both yield undefined, which the Convex mutations treat as "no version
// reported" rather than an error.
export function freightFateClientVersion(request: Request) {
  const header = (request.headers.get("user-agent") ?? "").trim();
  return /^FreightFate\/([\x21-\x7e]{1,64})$/.exec(header)?.[1];
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

  const saveName = freightFateSaveSlotName(value);

  if (saveName.length > 64) {
    throw new Error("Save name is too long.");
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
  clientVersion?: string;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.action(anyApi.freightFateSaveActions.uploadValidatedSave, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: normalizeFreightFateSaveName(input.saveName),
    saveVersion: input.saveVersion,
    parentRevision: input.parentRevision,
    contentHash: input.contentHash,
    content: input.content,
    summary: input.summary.trim().replace(/\s+/g, " ").slice(0, 160),
    ...(input.clientVersion ? { clientVersion: input.clientVersion } : {}),
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

  return client.action(anyApi.freightFateSaveActions.downloadValidatedSave, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: normalizeFreightFateSaveName(input.saveName),
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    now: Date.now(),
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

export async function postFreightFateDelivery(input: {
  driverId: string; driverToken: string; eventId: string; occurredAt: number;
  payload: { version: 1; cargo: string; weightPounds: number; origin: string;
    destination: string; distanceMiles: number; onTime: boolean; notableCondition?: string };
}) {
  const client = getConvexClient();
  if (!client) return null;
  return client.mutation(anyApi.freightFate.publishDeliveryCompleted, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    eventId: normalizeFreightFateEventText(input.eventId, "Event ID", 96),
    occurredAt: input.occurredAt, payload: input.payload, now: Date.now(),
  });
}

export async function postFreightFateAchievement(input: {
  driverId: string; driverToken: string; eventId: string; achievementKey: string;
  name: string; description: string; earnedAt: number;
}) {
  const client = getConvexClient();
  if (!client) return null;
  return client.mutation(anyApi.freightFate.publishAchievementEarned, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    eventId: normalizeFreightFateEventText(input.eventId, "Event ID", 96),
    achievementKey: normalizeFreightFateEventText(input.achievementKey, "Achievement key", 96),
    name: normalizeFreightFateEventText(input.name, "Achievement name", 100),
    description: normalizeFreightFateEventText(input.description, "Achievement description", 240),
    earnedAt: input.earnedAt, now: Date.now(),
  });
}

export async function postFreightFateCareerMilestone(input: {
  driverId: string; driverToken: string; eventId: string;
  milestoneType: "first_delivery" | "career_level"; level?: number; occurredAt: number;
}) {
  const client = getConvexClient();
  if (!client) return null;
  return client.mutation(anyApi.freightFate.publishCareerMilestone, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    eventId: normalizeFreightFateEventText(input.eventId, "Event ID", 96),
    milestoneType: input.milestoneType, ...(input.level === undefined ? {} : { level: input.level }),
    occurredAt: input.occurredAt, now: Date.now(),
  });
}

export async function getFreightFatePublicUpdates(limit = 20, before?: { occurredAt: number; eventId: string }) {
  const client = getConvexClient();
  if (!client) return null;
  return client.query(anyApi.freightFate.getPublicUpdates, { limit, ...(before ? { before } : {}) });
}

export async function postFreightFatePresence(input: {
  driverId: string;
  driverToken: string;
  activity: string;
  detail: string;
  clientVersion?: string;
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
    ...(input.clientVersion ? { clientVersion: input.clientVersion } : {}),
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

export const FREIGHT_FATE_PRESENCE_SNAPSHOT_TAG = "freight-fate-presence-board";

// How long a display snapshot may be reused. Kept well inside the server's
// PRESENCE_TTL_MS so a cached roster still describes drivers the server would
// agree are on duty.
export const FREIGHT_FATE_PRESENCE_SNAPSHOT_SECONDS = 60;

/** Authoritative, uncached read of who is on duty right now.
 *
 * Every call reaches the backend, so this is the expensive path -- reserve it
 * for decisions, not for display. When something actionable is built on
 * presence (a CB channel by range, joining a convoy, messaging a driver), the
 * action must confirm against this rather than against a snapshot: acting on a
 * cached roster means offering the player a driver who has already signed off,
 * and a failure the player cannot make sense of. Anything that merely *shows*
 * the board wants getFreightFatePresenceBoardSnapshot instead.
 *
 * Returns null when online presence is not configured (no Convex client);
 * anything else that goes wrong throws.
 */
export async function getFreightFateLivePresenceBoard(): Promise<FreightFatePresenceBoard | null> {
  const client = getConvexClient();

  if (!client) {
    if (process.env.NODE_ENV === "production") {
      // Not configured in production means an env-var problem, and the board
      // simply omits itself -- silently, and with nothing thrown to catch.
      // Leave a trace so it is not invisible from both sides at once.
      console.warn("Freight Fate online presence is not configured; the drivers board will be omitted.");
    }

    return null;
  }

  return client.query(anyApi.freightFate.getPresenceBoard, { now: Date.now() });
}

/** The board as a cached snapshot, for anything that displays it.
 *
 * The whole payload is cached together, `asOf` included, so a snapshot stays
 * true to itself: every "updated N minutes ago" phrase is measured against the
 * same stamp the page shows. Callers therefore never need to re-derive ages
 * against a live clock, which is what would make a cached board lie.
 *
 * This is what caps backend reads. Without it, read volume tracks page views
 * and API polling rather than the number of people actually driving.
 */
export const getFreightFatePresenceBoardSnapshot = unstable_cache(
  getFreightFateLivePresenceBoard,
  [FREIGHT_FATE_PRESENCE_SNAPSHOT_TAG],
  {
    revalidate: FREIGHT_FATE_PRESENCE_SNAPSHOT_SECONDS,
    tags: [FREIGHT_FATE_PRESENCE_SNAPSHOT_TAG],
  },
);

export async function getFreightFateDriverProfile(driverId: string, limit = 20, before?: { occurredAt: number; eventId: string }) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFate.getDriverProfile, {
    driverId: normalizeFreightFateDriverId(driverId),
    limit,
    ...(before ? { before } : {}),
    now: Date.now(),
  });
}

export async function setFreightFateProfileSharing(input: {
  driverId: string;
  driverToken: string;
  enabled: boolean;
}) {
  const client = getConvexClient();
  if (!client) return null;
  return client.mutation(anyApi.freightFate.setProfileSharing, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    enabled: input.enabled,
    now: Date.now(),
  });
}
