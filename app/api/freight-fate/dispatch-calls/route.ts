import {
  createDispatchCall,
  dispatchCallRequestError,
  dispatchCallResponse,
  normalizeFreightFateDispatchCallFacts,
  parseDispatchCallRequest,
  dispatchCallText,
} from "@/lib/freight-fate-dispatch-calls";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { body, driverId, driverTokenHash } = await parseDispatchCallRequest(request);
    const result = await createDispatchCall({
      driverId,
      driverTokenHash,
      requestId: dispatchCallText(body.requestId, "Request ID"),
      kind: dispatchCallText(body.kind, "Call kind", 48),
      facts: normalizeFreightFateDispatchCallFacts(body.facts),
      now: Date.now(),
    });
    return dispatchCallResponse(result);
  } catch (error) {
    return dispatchCallRequestError(error);
  }
}
