import { NextResponse } from "next/server";
import {
  createFreightFateSetupSession,
  getFreightFateSetupStatus,
  normalizeFreightFateDisplayName,
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

type SetupRequest = {
  setupToken?: unknown;
  driverToken?: unknown;
  driverId?: unknown;
  displayName?: unknown;
  expiresInMinutes?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SetupRequest;
    const setupToken = normalizeFreightFateToken(body.setupToken, "Setup token");
    const driverToken = normalizeFreightFateToken(body.driverToken, "Driver token");
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const displayName = body.displayName
      ? normalizeFreightFateDisplayName(body.displayName, "Freight Fate Driver")
      : undefined;
    const expiresInMinutes =
      typeof body.expiresInMinutes === "number" ? body.expiresInMinutes : undefined;

    const saved = await createFreightFateSetupSession({
      setupToken,
      driverToken,
      driverId,
      displayName,
      expiresInMinutes,
    });

    if (!saved) {
      return NextResponse.json({ error: "Freight Fate online setup is not configured." }, { status: 503 });
    }

    const setupUrl = new URL("/freight-fate/online/setup", request.url);
    setupUrl.searchParams.set("token", setupToken);

    return NextResponse.json({
      ok: true,
      driverId,
      setupUrl: setupUrl.toString(),
      expiresAt: saved.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid setup request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Setup token is required." }, { status: 400 });
  }

  try {
    const setupToken = normalizeFreightFateToken(token, "Setup token");
    const status = await getFreightFateSetupStatus(setupToken);

    if (!status.configured) {
      return NextResponse.json({ error: "Freight Fate online setup is not configured." }, { status: 503 });
    }

    if (!status.found) {
      return NextResponse.json({ found: false, confirmed: false });
    }

    return NextResponse.json({
      found: true,
      confirmed: status.confirmed,
      expired: status.expired,
      driverId: status.driverId,
      profileUrl: status.confirmed ? `/freight-fate/drivers/${status.driverId}` : null,
      expiresAt: status.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid setup token.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
