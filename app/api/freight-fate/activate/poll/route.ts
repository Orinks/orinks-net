import { NextResponse } from "next/server";
import { pollFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Parsing and validating the body is the only part of this route where a
  // throw is genuinely the caller's fault. Kept in its own try/catch so a
  // Convex or network failure below can never be mistaken for a bad request.
  let deviceCode: string;
  try {
    const body = (await request.json()) as { device_code?: unknown };
    const candidate = typeof body.device_code === "string" ? body.device_code : "";
    if (!/^[0-9a-f]{64}$/.test(candidate)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    deviceCode = candidate;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
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
    // pollFreightFateActivation makes two Convex calls; any failure here is
    // an infrastructure problem, not something wrong with the request the
    // game sent, so it must read as "come back later," not "you're wrong."
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
