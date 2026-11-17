import { NextResponse } from "next/server";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
  renameFreightFateGuest,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  not_a_guest: 422,
  rate_limited: 429,
  name_taken: 503,
};

// Another word-list name for a guest driver. The server picks it; the game
// only asks.
export async function POST(request: Request) {
  let driverId: string;
  let driverToken: string;
  try {
    driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as { driverId?: unknown };
    driverId = normalizeFreightFateDriverId(body.driverId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid rename request." },
      { status: 400 },
    );
  }
  try {
    const result = await renameFreightFateGuest({ driverId, driverToken });
    if (!result) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 400 });
    }
    return NextResponse.json({ ok: true, display_name: result.displayName });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
