import { NextResponse } from "next/server";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
  setFreightFateProfileSharing,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as { driverId?: unknown; enabled?: unknown };
    const driverId = normalizeFreightFateDriverId(body.driverId);
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Profile sharing state is required." }, { status: 400 });
    }
    const result = await setFreightFateProfileSharing({ driverId, driverToken, enabled: body.enabled });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: result.reason === "driver_not_found" ? 404 : result.reason === "rate_limited" ? 429 : 401 },
      );
    }
    return NextResponse.json({ ok: true, enabled: result.enabled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid profile-sharing request." },
      { status: 400 },
    );
  }
}
