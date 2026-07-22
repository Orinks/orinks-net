import { NextResponse } from "next/server";
import { freightFateClientVersion, normalizeFreightFateDriverId, normalizeFreightFateEventText, normalizeFreightFateToken, postFreightFateMastodonShare } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

// The game's outbox drops an item for good on 400/401/403/404 and retries
// with backoff on everything else, so the split below decides which failures
// are permanent (a dead link, a bad payload) and which heal (rate limits,
// the instance being down).
const FAILURE_STATUS: Record<string, number> = {
  invalid_payload: 400,
  unauthorized: 401,
  no_link: 403,
  mastodon_rejected: 403,
  driver_not_found: 404,
  rate_limited: 429,
  mastodon_unreachable: 503,
};

export async function POST(request: Request) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const body = await request.json() as { driverId?: unknown; eventId?: unknown; occurredAt?: unknown; payload?: unknown };
    const result = await postFreightFateMastodonShare({
      driverId: normalizeFreightFateDriverId(body.driverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
      eventId: normalizeFreightFateEventText(body.eventId, "Event ID", 96),
      occurredAt: typeof body.occurredAt === "number" ? body.occurredAt : Date.now(),
      payload: body.payload,
      clientVersion: freightFateClientVersion(request),
    });
    if (!result) return NextResponse.json({ error: "Freight Fate online is not configured." }, { status: 503 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 401 });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Mastodon share." }, { status: 400 }); }
}
