import { createHash } from "node:crypto";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";

export type FreightFateVisibility = "private" | "unlisted";

export type FreightFateSetupStatus =
  | { configured: false }
  | { configured: true; found: false }
  | {
      configured: true;
      found: true;
      confirmed: boolean;
      expired: boolean;
      driverId: string;
      displayName?: string;
      expiresAt: number;
      confirmedAt?: number;
    };

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
  return value === "unlisted" ? "unlisted" : "private";
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

export async function createFreightFateSetupSession(input: {
  setupToken: string;
  driverToken: string;
  driverId: string;
  displayName?: string;
  expiresInMinutes?: number;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  const now = Date.now();
  const expiresInMinutes = Math.min(Math.max(input.expiresInMinutes ?? 15, 1), 60);
  const expiresAt = now + expiresInMinutes * 60_000;

  return client.mutation(anyApi.freightFate.createSetupSession, {
    setupTokenHash: hashFreightFateToken(input.setupToken),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    driverId: normalizeFreightFateDriverId(input.driverId),
    displayName: input.displayName
      ? normalizeFreightFateDisplayName(input.displayName, "Freight Fate Driver")
      : undefined,
    expiresAt,
    now,
  });
}

export async function getFreightFateSetupStatus(setupToken: string): Promise<FreightFateSetupStatus> {
  const client = getConvexClient();

  if (!client) {
    return { configured: false };
  }

  const status = await client.query(anyApi.freightFate.getSetupSession, {
    setupTokenHash: hashFreightFateToken(setupToken),
    now: Date.now(),
  });

  return { configured: true, ...status } as FreightFateSetupStatus;
}

export async function confirmFreightFateSetup(input: {
  setupToken: string;
  displayName: string;
  visibility: FreightFateVisibility;
}) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.freightFate.confirmSetupSession, {
    setupTokenHash: hashFreightFateToken(input.setupToken),
    displayName: normalizeFreightFateDisplayName(input.displayName, "Freight Fate Driver"),
    visibility: input.visibility,
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
