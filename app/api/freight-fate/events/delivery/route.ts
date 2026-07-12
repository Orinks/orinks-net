import { NextResponse } from "next/server";
import { normalizeFreightFateDriverId, normalizeFreightFateEventText, normalizeFreightFateToken, postFreightFateDelivery } from "@/lib/freight-fate-online";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const body = await request.json() as Parameters<typeof postFreightFateDelivery>[0];
    const result = await postFreightFateDelivery({ ...body,
      driverId: normalizeFreightFateDriverId(body.driverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
      eventId: normalizeFreightFateEventText(body.eventId, "Event ID", 96),
    });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "rate_limited" ? 429 : result.reason === "sharing_not_enabled" ? 403 : 401 });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid delivery event." }, { status: 400 }); }
}
