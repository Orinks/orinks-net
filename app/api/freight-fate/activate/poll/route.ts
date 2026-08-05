import { NextResponse } from "next/server";
import { pollFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { device_code?: unknown };
    const deviceCode = typeof body.device_code === "string" ? body.device_code : "";
    if (!/^[0-9a-f]{64}$/.test(deviceCode)) {
      return NextResponse.json({ status: "expired" }, { status: 410 });
    }
    const result = await pollFreightFateActivation({ deviceCode });
    if (!result) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (result.status === "expired") {
      return NextResponse.json({ status: "expired" }, { status: 410 });
    }
    if (result.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }
    return NextResponse.json({
      status: "ready",
      driver_id: result.driverId,
      token: result.token,
      display_name: result.displayName,
    });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
