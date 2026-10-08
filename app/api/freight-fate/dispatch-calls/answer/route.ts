import {
  answerDispatchCall,
  dispatchCallRequestError,
  dispatchCallResponse,
  dispatchCallText,
  normalizeDispatchCallId,
  parseDispatchCallRequest,
} from "@/lib/freight-fate-dispatch-calls";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { body, driverId, driverTokenHash } = await parseDispatchCallRequest(request);
    const result = await answerDispatchCall({
      driverId,
      driverTokenHash,
      callId: normalizeDispatchCallId(body.callId),
      decision: dispatchCallText(body.decision, "Decision", 48),
      now: Date.now(),
    });
    return dispatchCallResponse(result, true);
  } catch (error) {
    return dispatchCallRequestError(error);
  }
}
