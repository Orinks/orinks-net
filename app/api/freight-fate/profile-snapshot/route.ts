import { NextResponse } from "next/server";
import { normalizeFreightFateDriverId, normalizeFreightFateToken, postFreightFateProfileSnapshot } from "@/lib/freight-fate-online";

export const runtime = "nodejs";
const statuses: Record<string, number> = { driver_not_found: 404, unauthorized: 401, rate_limited: 429, sharing_not_enabled: 403 };

export async function POST(request: Request) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const body = await request.json() as { driverId?: unknown; snapshot?: unknown };
    const result = await postFreightFateProfileSnapshot({
      driverId: normalizeFreightFateDriverId(body.driverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
      snapshot: body.snapshot && typeof body.snapshot === "object" ? body.snapshot as Record<string, unknown> : {},
    });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statuses[result.reason] ?? 400 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid snapshot." }, { status: 400 });
  }
}
