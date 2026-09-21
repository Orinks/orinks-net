import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { startFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

// The game may name the computer it is connecting. Anything unreadable is
// simply absent: an older build sends no body at all, and this endpoint has
// always accepted that.
async function machineKey(request: Request) {
  try {
    const body = (await request.json()) as { machine_key?: unknown } | null;
    const key = body?.machine_key;
    return typeof key === "string" ? key.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const started = await startFreightFateActivation({
      clientKey: clientKey(request),
      machineKey: await machineKey(request),
      siteOrigin: new URL(request.url).origin,
    });
    if (!started) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json(started);
  } catch (error) {
    // startActivation throws ConvexError({ code: "rate_limited" }) when the
    // caller is over budget, but also ConvexError({ code: "activation_unavailable" })
    // when user-code minting exhausts its retries, and a network or Convex
    // outage throws something else again. Only the rate limiter is the
    // game's fault; everything else means the service is down, which the
    // game should back off from differently than "you are rate limited."
    const data = error instanceof ConvexError ? (error.data as { code?: string } | undefined) : undefined;
    if (data?.code === "rate_limited") {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
