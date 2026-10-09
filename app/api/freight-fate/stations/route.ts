import { NextResponse } from "next/server";
import {
  freightFateClientVersion,
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
} from "@/lib/freight-fate-online";
import { getFreightFateCommunityStations, suggestFreightFateStation } from "@/lib/freight-fate-stations";
import { REFUSALS } from "@/convex/freightFateStationRules";

export const runtime = "nodejs";
// A suggestion waits on the stream probe and the shipped-catalog read.
export const maxDuration = 60;

// The community station list: stations players suggested and the owner
// accepted, in the game's own catalog row shape. Public and unauthenticated;
// the game reads it once per launch and keeps a copy for offline play.
export async function GET() {
  const stations = await getFreightFateCommunityStations();
  if (!stations) {
    return NextResponse.json({ error: "Freight Fate stations are not configured." }, { status: 503 });
  }
  return NextResponse.json(stations, { headers: { "cache-control": "no-store" } });
}

const FORM_FIELDS = ["kind", "name", "streamUrl", "callSign", "frequency", "city", "state", "genre", "note"];

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  rate_limited: 429,
  daily_limit: 429,
};

function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

// A suggestion from the game. Every answer, success or refusal, carries a
// `message` written to be spoken to the player as it comes.
export async function POST(request: Request) {
  let driverId: string;
  let driverToken: string;
  let body: Record<string, unknown>;
  try {
    driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    body = (await request.json()) as Record<string, unknown>;
    driverId = normalizeFreightFateDriverId(body.driverId);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unauthorized", message: REFUSALS.unauthorized },
      { status: 401 },
    );
  }
  const form: Record<string, string> = {};
  for (const field of FORM_FIELDS) {
    if (typeof body[field] === "string") form[field] = body[field] as string;
  }
  const result = await suggestFreightFateStation({
    driverId,
    driverToken,
    clientVersion: freightFateClientVersion(request),
    form,
  });
  if (!result) {
    return NextResponse.json(
      { ok: false, reason: "not_configured", message: REFUSALS.not_configured },
      { status: 503 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(result, { status: FAILURE_STATUS[result.reason] ?? 422 });
  }
  return NextResponse.json(result);
}
