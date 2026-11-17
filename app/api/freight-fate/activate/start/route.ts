import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
  startFreightFateActivation,
} from "@/lib/freight-fate-online";
import { clientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

function clientKey(request: Request) {
  return clientIp(request) ?? "unknown";
}

// The game may name the computer it is connecting. Anything unreadable is
// simply absent: an older build sends no body at all, and this endpoint has
// always accepted that.
//
// A guest connecting an account also sends its driver id in the body and its
// token as a Bearer header, so its journal and achievements can follow it.
// Anything that does not prove a guest is ignored, never an error.
async function readBody(request: Request) {
  try {
    const body = (await request.json()) as { machine_key?: unknown; guest_driver_id?: unknown } | null;
    const key = body?.machine_key;
    const guestId = body?.guest_driver_id;
    return {
      machineKey: typeof key === "string" ? key.slice(0, 64) : undefined,
      guestDriverId: typeof guestId === "string" ? guestId : undefined,
    };
  } catch {
    return { machineKey: undefined, guestDriverId: undefined };
  }
}

function guestProof(request: Request, guestDriverId: string | undefined) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || !guestDriverId) return undefined;
  try {
    return {
      driverId: normalizeFreightFateDriverId(guestDriverId),
      driverToken: normalizeFreightFateToken(token, "Driver token"),
    };
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const started = await startFreightFateActivation({
      clientKey: clientKey(request),
      machineKey: body.machineKey,
      guest: guestProof(request, body.guestDriverId),
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
