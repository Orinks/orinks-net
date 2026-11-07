import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { createFreightFateGuest } from "@/lib/freight-fate-online";
import { clientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

// The game names its computer the same way it does when activating, so the
// guest's one computer shows up as that computer if it connects an account.
async function machineKey(request: Request) {
  try {
    const body = (await request.json()) as { machine_key?: unknown } | null;
    const key = body?.machine_key;
    return typeof key === "string" ? key.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

// A new guest driver: no account, a word-list name the server picks, and a
// token for this computer. Nothing is public until the game turns Profile
// sharing on.
export async function POST(request: Request) {
  try {
    const made = await createFreightFateGuest({
      clientKey: clientIp(request) ?? "unknown",
      machineKey: await machineKey(request),
    });
    if (!made || !made.ok) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({
      status: "ready",
      driver_id: made.driverId,
      token: made.token,
      display_name: made.displayName,
      guest: true,
    });
  } catch (error) {
    const data = error instanceof ConvexError ? (error.data as { code?: string } | undefined) : undefined;
    if (data?.code === "rate_limited") {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
