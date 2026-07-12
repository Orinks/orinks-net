import { NextResponse } from "next/server";
import { normalizeFreightFateDriverId, normalizeFreightFateToken, postFreightFateAchievement } from "@/lib/freight-fate-online";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const body = await request.json() as Parameters<typeof postFreightFateAchievement>[0];
    const result = await postFreightFateAchievement({ ...body,
      driverId: normalizeFreightFateDriverId(body.driverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
    });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "rate_limited" ? 429 : result.reason === "sharing_not_enabled" ? 403 : 401 });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid achievement." }, { status: 400 }); }
}
