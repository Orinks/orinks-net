import {
  claimDispatchCall,
  dispatchCallRequestError,
  dispatchCallResponse,
  normalizeDispatchCallId,
  parseDispatchCallRequest,
} from "@/lib/freight-fate-dispatch-calls";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { body, driverId, driverTokenHash } = await parseDispatchCallRequest(request);
    const result = await claimDispatchCall({
      driverId,
      driverTokenHash,
      callId: normalizeDispatchCallId(body.callId),
      now: Date.now(),
    });
    return dispatchCallResponse(result, true);
  } catch (error) {
    return dispatchCallRequestError(error);
  }
}
