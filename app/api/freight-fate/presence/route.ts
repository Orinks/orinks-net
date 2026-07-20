import { NextResponse } from "next/server";
import {
  freightFateClientVersion,
  getFreightFatePresenceBoardSnapshot,
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
  postFreightFatePresence,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

type PresenceRequest = {
  driverId?: unknown;
  activity?: unknown;
  detail?: unknown;
};

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  return match?.[1];
}

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  rate_limited: 429,
};

export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as PresenceRequest;
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const activity = typeof body.activity === "string" ? body.activity : "";
    const detail = typeof body.detail === "string" ? body.detail : "";
    const result = await postFreightFatePresence({
      driverId,
      driverToken,
      activity,
      detail,
      clientVersion: freightFateClientVersion(request),
    });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 400 });
    }

    return NextResponse.json({ ok: true, cleared: result.cleared });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid presence request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Public and unauthenticated, so its call volume is whatever the internet
// decides: read from the shared snapshot rather than the backend, or a single
// impatient poller costs a backend query per request. `no-store` still stops
// clients and CDNs holding a roster past its stamp; the snapshot is what keeps
// the backend cost flat.
export async function GET() {
  const board = await getFreightFatePresenceBoardSnapshot();

  if (!board) {
    return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
  }

  return NextResponse.json(board, {
    headers: { "cache-control": "no-store" },
  });
}
