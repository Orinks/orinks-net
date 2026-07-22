import { NextResponse } from "next/server";
import { getFreightFateMastodonStatus, normalizeFreightFateDriverId, normalizeFreightFateToken } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

// The game's "Check link status" item: authenticated by the same bearer
// driver token as every other game call, answering only linked-or-not and
// the display handle. Never the token, never the instance credentials.
export async function GET(request: Request) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const driverId = new URL(request.url).searchParams.get("driverId");
    const result = await getFreightFateMastodonStatus({
      driverId: normalizeFreightFateDriverId(driverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
    });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "driver_not_found" ? 404 : 401 });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid status request." }, { status: 400 }); }
}
