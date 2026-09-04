import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { freightFateSaveSlotName } from "./freight-fate-save-name";
import { FREIGHT_FATE_PROFILE_SUMMARY_EVENTS, freightFateProfileSummary } from "./freight-fate-profile-summary";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import type {
  FreightFatePresenceBoard,
  FreightFatePresenceDriver,
} from "./freight-fate-presence";
import { formatUserCode } from "@/convex/freightFateActivation";

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

// Defined in lib/freight-fate-presence.ts so the browser half of the drivers
// list can use it as well; re-exported here for the server-side callers that
// have always found it in this module.
export { normalizeFreightFateDisplayName } from "./freight-fate-presence";

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
  meaningfulPlay?: unknown;
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
    ...(input.meaningfulPlay !== undefined
      ? { meaningfulPlay: input.meaningfulPlay }
      : {}),
    ...(input.clientVersion ? { clientVersion: input.clientVersion } : {}),
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

export async function deleteFreightFateSaveSlot(input: {
  driverId: string;
  driverToken: string;
  saveName: string;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.freightFateSaves.deleteSaveSlot, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: normalizeFreightFateSaveName(input.saveName),
  });
}

export async function setFreightFatePublicSave(input: {
  driverId: string;
  driverToken: string;
  saveName: string | null;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.freightFateSaves.setPublicSave, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    saveName: input.saveName === null ? null : normalizeFreightFateSaveName(input.saveName),
    now: Date.now(),
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

export async function postFreightFateMastodonShare(input: {
  driverId: string; driverToken: string; eventId: string; occurredAt: number;
  payload: unknown; clientVersion?: string;
}) {
  const client = getConvexClient();
  if (!client) return null;
  return client.action(anyApi.freightFateMastodon.shareNotableDelivery, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    eventId: normalizeFreightFateEventText(input.eventId, "Event ID", 96),
    occurredAt: input.occurredAt, payload: input.payload,
    ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion }),
    now: Date.now(),
  });
}

export async function getFreightFateMastodonStatus(input: { driverId: string; driverToken: string }) {
  const client = getConvexClient();
  if (!client) return null;
  return client.query(anyApi.freightFateMastodon.statusForGame, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
  });
}

export const FREIGHT_FATE_UPDATES_SNAPSHOT_TAG = "freight-fate-public-updates";

// How long a page of the public feed may be reused. Unlike the presence board
// this has no correctness ceiling to stay inside -- the feed is finished
// deliveries, which nobody acts on and which never stop being true -- so the
// only question is how stale a page may look. Two minutes reads as live.
export const FREIGHT_FATE_UPDATES_SNAPSHOT_SECONDS = 120;

async function readFreightFatePublicUpdates(limit: number, before?: { occurredAt: number; eventId: string }) {
  const client = getConvexClient();
  if (!client) return null;
  return client.query(anyApi.freightFate.getPublicUpdates, { limit, ...(before ? { before } : {}) });
}

/** A page of the public feed, cached per (limit, cursor).
 *
 * This is what caps backend reads, the same job the presence snapshot does.
 * Uncached, every server render read the feed afresh, so cost tracked page
 * views rather than the number of deliveries actually finishing -- and the
 * traffic that dominates is a crawler walking the "Older updates" chain in
 * bursts, not players. Measured 2026-08-11: 17 KB per call, ~170 calls an
 * hour, two thirds of the whole deployment's database I/O.
 */
export const getFreightFatePublicUpdates = unstable_cache(
  (limit = 20, before?: { occurredAt: number; eventId: string }) =>
    readFreightFatePublicUpdates(limit, before),
  [FREIGHT_FATE_UPDATES_SNAPSHOT_TAG],
  {
    revalidate: FREIGHT_FATE_UPDATES_SNAPSHOT_SECONDS,
    tags: [FREIGHT_FATE_UPDATES_SNAPSHOT_TAG],
  },
);

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

// Defined in lib/freight-fate-presence.ts, which the browser can import and
// this module cannot be (node:crypto, above). Re-exported here so the
// server-side callers below keep reading as one module.
export type { FreightFatePresenceBoard, FreightFatePresenceDriver };

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

/** The game's copy of a public profile: the profile page's sections, trimmed
 * to what a spoken list reads (see `freightFateProfileSummary`), cached for
 * the same minute the drivers list is.
 *
 * Public and unauthenticated like the presence GET, so it gets the same
 * treatment: a player arrowing down the drivers list and opening one profile
 * after another costs the backend one read per driver per minute, not one
 * per Enter. `driverId` is part of the cache key, so pass it normalized --
 * the route does -- or two spellings of one driver are two cache entries.
 *
 * `configured: false` means no backend is wired up at all (the presence
 * board's null), which is a different answer from a profile that is hidden:
 * the first is a 503 the game reads as "could not be reached", the second a
 * 404 it reads as "not public".
 */
export const getFreightFateDriverProfileSummary = unstable_cache(
  async (driverId: string) => {
    const client = getConvexClient();

    if (!client) {
      return { configured: false as const, profile: null };
    }

    const profile = await client.query(anyApi.freightFate.getDriverProfile, {
      driverId,
      limit: FREIGHT_FATE_PROFILE_SUMMARY_EVENTS,
      // The query's floor; the summary reads recentAchievements, not the page.
      achievementLimit: 1,
      now: Date.now(),
    });

    return { configured: true as const, profile: freightFateProfileSummary(profile) };
  },
  ["freight-fate-driver-profile-summary"],
  { revalidate: FREIGHT_FATE_PRESENCE_SNAPSHOT_SECONDS },
);

export async function getFreightFateDriverProfile(
  driverId: string,
  limit = 20,
  before?: { occurredAt: number; eventId: string },
  achievementBefore?: { sortAt: number; achievementKey: string },
) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.freightFate.getDriverProfile, {
    driverId: normalizeFreightFateDriverId(driverId),
    limit,
    achievementLimit: 20,
    ...(before ? { before } : {}),
    ...(achievementBefore ? { achievementBefore } : {}),
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

// Poll spacing the game starts from; it backs off from here on its own.
export const FREIGHT_FATE_ACTIVATION_INTERVAL_S = 3;

export async function startFreightFateActivation(input: {
  clientKey: string;
  siteOrigin: string;
  // The game's opaque name for the computer connecting. Carried to the device
  // row so that connecting the same PC again replaces its entry instead of
  // spending another slot on the ten-computer list.
  machineKey?: string;
}) {
  const client = getConvexClient();
  if (!client) {
    return null;
  }
  const started = await client.mutation(anyApi.freightFateActivation.startActivation, {
    clientKey: input.clientKey.slice(0, 64),
    machineKey: input.machineKey,
    now: Date.now(),
  });
  // Formatted by the same function the /activate page's parser was built
  // against, so the dash the game speaks and the dash the page forgives can
  // never drift apart.
  const formatted = formatUserCode(started.userCode);
  const verificationUri = `${input.siteOrigin}/activate`;
  return {
    device_code: started.deviceCode,
    user_code: formatted,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${formatted}`,
    expires_in: Math.max(0, Math.round((started.expiresAt - Date.now()) / 1000)),
    interval: FREIGHT_FATE_ACTIVATION_INTERVAL_S,
  };
}

export async function pollFreightFateActivation(input: { deviceCode: string }) {
  const client = getConvexClient();
  if (!client) {
    return null;
  }
  // Hashed here, on the server, so the stored value and the polled value are
  // produced by the same helper the game never sees.
  const deviceCodeHash = hashFreightFateToken(input.deviceCode);
  const status = await client.query(anyApi.freightFateActivation.checkActivation, {
    deviceCodeHash,
    now: Date.now(),
  });
  if (status !== "ready") {
    return { status } as const;
  }
  const redeemed = await client.mutation(anyApi.freightFateActivation.redeemActivation, {
    deviceCodeHash,
    now: Date.now(),
  });
  // Lost a race with another poll holding the same secret: the row is gone
  // and the token went to that caller. Expired is the honest answer.
  if (!redeemed) {
    return { status: "expired" } as const;
  }
  return {
    status: "ready",
    driverId: redeemed.driverId,
    token: redeemed.token,
    displayName: redeemed.displayName,
  } as const;
}
