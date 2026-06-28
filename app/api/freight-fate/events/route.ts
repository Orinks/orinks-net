import { NextResponse } from "next/server";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateEventText,
  normalizeFreightFateToken,
  postFreightFateDriverEvent,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

type EventRequest = {
  driverId?: unknown;
  eventId?: unknown;
  eventType?: unknown;
  summary?: unknown;
  occurredAt?: unknown;
};

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  return match?.[1];
}

export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as EventRequest;
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const eventId = normalizeFreightFateEventText(body.eventId, "Event ID", 96);
    const eventType = normalizeFreightFateEventText(body.eventType, "Event type", 48);
    const summary = normalizeFreightFateEventText(body.summary, "Summary", 280);
    const occurredAt = typeof body.occurredAt === "number" ? body.occurredAt : undefined;
    const result = await postFreightFateDriverEvent({
      driverId,
      driverToken,
      eventId,
      eventType,
      summary,
      occurredAt,
    });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate online events are not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.reason === "unauthorized" ? 401 : 404 });
    }

    return NextResponse.json({ ok: true, duplicate: result.duplicate, driverId: result.driverId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid event request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
