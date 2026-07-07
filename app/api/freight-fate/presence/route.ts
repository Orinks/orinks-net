import { NextResponse } from "next/server";
import {
  getFreightFatePresenceBoard,
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

export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as PresenceRequest;
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const activity = typeof body.activity === "string" ? body.activity : "";
    const detail = typeof body.detail === "string" ? body.detail : "";
    const result = await postFreightFatePresence({ driverId, driverToken, activity, detail });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.reason === "unauthorized" ? 401 : 404 });
    }

    return NextResponse.json({ ok: true, cleared: result.cleared });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid presence request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  const board = await getFreightFatePresenceBoard();

  if (!board) {
    return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
  }

  return NextResponse.json(board, {
    headers: { "cache-control": "no-store" },
  });
}
