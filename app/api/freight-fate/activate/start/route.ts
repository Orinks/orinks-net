import { NextResponse } from "next/server";
import { startFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  try {
    const started = await startFreightFateActivation({
      clientKey: clientKey(request),
      siteOrigin: new URL(request.url).origin,
    });
    if (!started) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json(started);
  } catch {
    // The only expected throw here is the rate limiter.
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
}
