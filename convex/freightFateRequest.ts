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

export type PresenceTruck = {
  city: string;
  nextWaypoint?: string;
  hosMinutesLeft?: number;
  fuelPercent?: number;
  cargo?: string;
  loaded: boolean;
};

export type PresenceUpdateArgs = {
  driverId: string;
  driverTokenHash: string;
  activity: string;
  detail: string;
  truck?: PresenceTruck;
  clientVersion?: string;
  now: number;
};

export type PresenceUpdateResult =
  | { ok: true; cleared: boolean; dispatch?: { carrierId: string; openOrders: number } }
  | { ok: false; reason: string };

function truckText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
  return text || undefined;
}

function truckNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** The live-dispatch truck state a carrier driver's heartbeat may carry.
 *
 * Optional and forgiving: a build that sends none, or sends something
 * malformed, gets an ordinary heartbeat, never a rejected one. Only a city
 * and loaded/empty are needed for the state to count.
 */
export function normalizePresenceTruck(value: unknown): PresenceTruck | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const city = truckText(raw.city, 80);
  if (!city || typeof raw.loaded !== "boolean") return undefined;
  const truck: PresenceTruck = { city, loaded: raw.loaded };
  const nextWaypoint = truckText(raw.nextWaypoint, 80);
  if (nextWaypoint) truck.nextWaypoint = nextWaypoint;
  // Game minutes; a driver can hold at most a fourteen-hour duty window.
  const hos = truckNumber(raw.hosMinutesLeft, 0, 14 * 60);
  if (hos !== undefined) truck.hosMinutesLeft = hos;
  const fuel = truckNumber(raw.fuelPercent, 0, 100);
  if (fuel !== undefined) truck.fuelPercent = fuel;
  const cargo = truckText(raw.cargo, 80);
  if (cargo) truck.cargo = cargo;
  return truck;
}

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
    const body = (await request.json()) as {
      driverId?: unknown; activity?: unknown; detail?: unknown; truck?: unknown;
    };
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const activity = typeof body.activity === "string" ? body.activity : "";
    const detail = typeof body.detail === "string" ? body.detail : "";
    const clientVersion = freightFateClientVersion(request);
    const truck = normalizePresenceTruck(body.truck);
    const result = await update({
      driverId,
      driverTokenHash: await sha256Hex(driverToken),
      // An empty activity means "going off duty"; keep it empty rather than
      // letting a normalizer reject it.
      activity: activity.trim().replace(/\s+/g, " ").slice(0, 160),
      detail: detail.trim().replace(/\s+/g, " ").slice(0, 160),
      ...(truck ? { truck } : {}),
      ...(clientVersion ? { clientVersion } : {}),
      now: Date.now(),
    });

    if (!result.ok) {
      return json({ error: result.reason }, PRESENCE_FAILURE_STATUS[result.reason] ?? 400);
    }

    // dispatch is present only for a carrier driver with live dispatch on:
    // how many orders wait, so the game fetches them only when there are some.
    return json({ ok: true, cleared: result.cleared, ...(result.dispatch ? { dispatch: result.dispatch } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid presence request.";

    return json({ error: message }, 400);
  }
}
