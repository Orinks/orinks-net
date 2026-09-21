import { NextResponse } from "next/server";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
  setFreightFatePublicSave,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  invalid_name: 422,
  rate_limited: 429,
};

// Chooses which career fronts the driver's public profile (null returns to
// the first-uploader rule). Every career keeps its private cloud backups
// either way.
export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as { driverId?: unknown; saveName?: unknown };
    const driverId = normalizeFreightFateDriverId(body.driverId);
    if (body.saveName !== null && typeof body.saveName !== "string") {
      return NextResponse.json({ error: "saveName must be a string or null." }, { status: 400 });
    }

    const result = await setFreightFatePublicSave({ driverId, driverToken, saveName: body.saveName });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate cloud saves are not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 400 });
    }

    return NextResponse.json({ ok: true, publicSaveName: result.publicSaveName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid public-career request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
