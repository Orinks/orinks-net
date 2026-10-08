// Request parsing shared by the site's Next routes and the Convex HTTP router.
// It lives here rather than in lib/ because Convex can only bundle files under
// convex/, and it must stay free of node: imports for the same reason;
// lib/freight-fate-online.ts re-exports it for the routes that have always
// imported it from there.

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

export type FreightFateDispatchCallFacts = {
  remainingMiles: number;
  hoursLeft: number;
  truckDamagePct: number;
  cargoDamagePct: number;
  hosRemainingMinutes?: number;
  weatherAlerts: number;
};

function finiteNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeFreightFateDispatchCallFacts(
  value: unknown,
): FreightFateDispatchCallFacts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Facts are required.");
  }

  const record = value as Record<string, unknown>;
  const remainingMiles = finiteNumber(record, "remainingMiles");
  const hoursLeft = finiteNumber(record, "hoursLeft");
  const truckDamagePct = finiteNumber(record, "truckDamagePct");
  const cargoDamagePct = finiteNumber(record, "cargoDamagePct");
  const weatherAlerts = finiteNumber(record, "weatherAlerts");
  const hosRemainingMinutes =
    record.hosRemainingMinutes === undefined
      ? undefined
      : finiteNumber(record, "hosRemainingMinutes");

  if (
    remainingMiles === null ||
    hoursLeft === null ||
    truckDamagePct === null ||
    cargoDamagePct === null ||
    weatherAlerts === null ||
    (record.hosRemainingMinutes !== undefined && hosRemainingMinutes === null)
  ) {
    throw new Error("Facts must contain finite numbers.");
  }

  return {
    remainingMiles: clamp(remainingMiles, 0, 10_000),
    hoursLeft: clamp(hoursLeft, -1_000, 1_000),
    truckDamagePct: clamp(truckDamagePct, 0, 100),
    cargoDamagePct: clamp(cargoDamagePct, 0, 100),
    ...(hosRemainingMinutes === undefined || hosRemainingMinutes === null
      ? {}
      : { hosRemainingMinutes: clamp(hosRemainingMinutes, 0, 10_000) }),
    weatherAlerts: clamp(Math.trunc(weatherAlerts), 0, 20),
  };
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.exec(header)?.[1];
}

// Same digest as hashFreightFateToken in lib/freight-fate-online.ts (node:crypto
// there, Web Crypto here). The HTTP presence test round-trips an issued token
// through it, so a mismatch fails there rather than signing every game out.
async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type PresenceUpdateArgs = {
  driverId: string;
  driverTokenHash: string;
  activity: string;
  detail: string;
  clientVersion?: string;
  now: number;
};

export type PresenceUpdateResult = { ok: true; cleared: boolean } | { ok: false; reason: string };

const PRESENCE_FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  rate_limited: 429,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The game's presence POST, answered the same way wherever it lands.
 *
 * Production reaches this through the Convex HTTP router: next.config.ts
 * rewrites the game's authenticated presence requests straight to it, so a
 * heartbeat never runs a Vercel function. The Next route keeps calling it as
 * the fallback for any deployment without that rewrite.
 */
export async function answerPresencePost(
  request: Request,
  update: (args: PresenceUpdateArgs) => Promise<PresenceUpdateResult>,
) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as { driverId?: unknown; activity?: unknown; detail?: unknown };
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const activity = typeof body.activity === "string" ? body.activity : "";
    const detail = typeof body.detail === "string" ? body.detail : "";
    const clientVersion = freightFateClientVersion(request);
    const result = await update({
      driverId,
      driverTokenHash: await sha256Hex(driverToken),
      // An empty activity means "going off duty"; keep it empty rather than
      // letting a normalizer reject it.
      activity: activity.trim().replace(/\s+/g, " ").slice(0, 160),
      detail: detail.trim().replace(/\s+/g, " ").slice(0, 160),
      ...(clientVersion ? { clientVersion } : {}),
      now: Date.now(),
    });

    if (!result.ok) {
      return json({ error: result.reason }, PRESENCE_FAILURE_STATUS[result.reason] ?? 400);
    }

    return json({ ok: true, cleared: result.cleared });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid presence request.";

    return json({ error: message }, 400);
  }
}
