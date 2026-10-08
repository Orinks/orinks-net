import { anyApi } from "convex/server";
import { normalizeFreightFateDispatchCallFacts } from "@/convex/freightFateRequest";
import {
  normalizeFreightFateDriverId,
  normalizeFreightFateEventText,
  normalizeFreightFateToken,
  hashFreightFateToken,
} from "@/lib/freight-fate-online";
import { getConvexClient } from "@/lib/convex";

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  call_not_found: 404,
  unauthorized: 401,
  not_listed: 403,
  rate_limited: 429,
  unsupported_kind: 400,
  invalid_request_id: 400,
  invalid_facts: 400,
  invalid_decision: 400,
  own_call: 403,
  not_claimed: 409,
  not_responder: 403,
  taken: 409,
  busy: 409,
  expired: 410,
};

export type DispatchCallRequest = {
  driverId: string;
  driverTokenHash: string;
  body: Record<string, unknown>;
};

export async function parseDispatchCallRequest(request: Request): Promise<DispatchCallRequest> {
  const authorization = request.headers.get("authorization") ?? "";
  const tokenValue = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  const token = normalizeFreightFateToken(tokenValue, "Driver token");
  const value: unknown = await request.json();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }

  const body = value as Record<string, unknown>;
  return {
    driverId: normalizeFreightFateDriverId(body.driverId),
    driverTokenHash: hashFreightFateToken(token),
    body,
  };
}

export function normalizeDispatchCallId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Call ID is required.");
  }
  const callId = value.trim();
  if (callId.length < 24 || callId.length > 96) {
    throw new Error("Call ID must be between 24 and 96 characters.");
  }
  return callId;
}

export function dispatchCallText(value: unknown, label: string, maxLength = 96) {
  return normalizeFreightFateEventText(value, label, maxLength);
}

export { normalizeFreightFateDispatchCallFacts };

async function dispatchMutation(name: string, args: Record<string, unknown>) {
  const client = getConvexClient();
  if (!client) {
    return null;
  }

  return await client.mutation(anyApi.freightFateDispatchCalls[name], args);
}

export function createDispatchCall(args: {
  driverId: string;
  driverTokenHash: string;
  requestId: string;
  kind: string;
  facts: unknown;
  now: number;
}) {
  return dispatchMutation("create", args);
}

export function getDispatchCallStatus(args: {
  driverId: string;
  driverTokenHash: string;
  callId: string;
  now: number;
}) {
  return dispatchMutation("status", args);
}

export function getOpenDispatchCalls(args: {
  driverId: string;
  driverTokenHash: string;
  now: number;
}) {
  return dispatchMutation("open", args);
}

export function claimDispatchCall(args: {
  driverId: string;
  driverTokenHash: string;
  callId: string;
  now: number;
}) {
  return dispatchMutation("claim", args);
}

export function answerDispatchCall(args: {
  driverId: string;
  driverTokenHash: string;
  callId: string;
  decision: string;
  now: number;
}) {
  return dispatchMutation("answer", args);
}

export function cancelDispatchCall(args: {
  driverId: string;
  driverTokenHash: string;
  callId: string;
  now: number;
}) {
  return dispatchMutation("cancel", args);
}

export function dispatchCallResponse(result: unknown, write = false) {
  if (result === null) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (result === undefined || result === false || typeof result !== "object") {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  const payload = result as Record<string, unknown>;
  if (payload.ok === false) {
    const reason = typeof payload.reason === "string" ? payload.reason : "invalid_request";
    return Response.json({ error: reason }, { status: FAILURE_STATUS[reason] ?? 400 });
  }

  const { ok: _ok, ...response } = payload;
  return Response.json(write ? { ok: true } : response);
}

export function dispatchCallRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : "Invalid call request.";
  return Response.json({ error: message }, { status: 400 });
}
