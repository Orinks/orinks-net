// The REST face of live dispatch (convex/freightFateDispatch.ts). Every route
// under /api/freight-fate/dispatch is a thin shell over one Convex function:
// read the Bearer driver token and the driver id, hash the token, call, and
// map a refusal to an HTTP status. Both games call these with the token they
// already hold.
import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import {
  hashFreightFateToken,
  normalizeFreightFateDriverId,
  normalizeFreightFateToken,
} from "@/lib/freight-fate-online";

const STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  rate_limited: 429,
  not_enabled: 403,
  no_carrier: 404,
  not_a_member: 404,
  invite_not_found: 404,
  order_not_found: 404,
  already_in_carrier: 409,
  order_closed: 409,
  order_id_taken: 409,
  reply_id_taken: 409,
  notes_muted: 409,
  wrong_order_kind: 409,
  invalid_payload: 400,
  text_blocked: 422,
};

type Result = { ok: boolean; reason?: string };

export async function answerDispatch(
  request: Request,
  fn: { type: "query" | "mutation"; name: string },
  pick: (body: Record<string, unknown>) => Record<string, unknown> = () => ({}),
) {
  const client = getConvexClient();
  if (!client) {
    return NextResponse.json({ error: "Freight Fate live dispatch is not configured." }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  let driverId: string;
  let driverToken: string;
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    driverToken = normalizeFreightFateToken(token, "Driver token");
    if (request.method === "GET") {
      driverId = normalizeFreightFateDriverId(new URL(request.url).searchParams.get("driverId"));
    } else {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
      body = parsed as Record<string, unknown>;
      driverId = normalizeFreightFateDriverId(body.driverId);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  const args = {
    ...pick(body),
    driverId,
    driverTokenHash: hashFreightFateToken(driverToken),
    now: Date.now(),
  };

  let result: Result;
  try {
    const ref = anyApi.freightFateDispatch[fn.name];
    result = fn.type === "query"
      ? await client.query(ref, args) as Result
      : await client.mutation(ref, args) as Result;
  } catch (error) {
    // Argument validation (a wrong type) is the caller's mistake, not ours.
    const message = error instanceof Error ? error.message : "";
    if (/ArgumentValidationError|Value does not match validator/i.test(message)) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }
    throw error;
  }

  if (!result.ok) {
    const { reason, ...rest } = result;
    return NextResponse.json(
      { error: reason ?? "refused", ...rest },
      { status: STATUS[reason ?? ""] ?? 400, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}

/** Copy only these keys from the body, and only when present. */
export function only(...keys: string[]) {
  return (body: Record<string, unknown>) =>
    Object.fromEntries(keys.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}
