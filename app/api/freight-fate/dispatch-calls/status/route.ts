import {
  dispatchCallRequestError,
  dispatchCallResponse,
  getDispatchCallStatus,
  normalizeDispatchCallId,
  parseDispatchCallRequest,
} from "@/lib/freight-fate-dispatch-calls";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { body, driverId, driverTokenHash } = await parseDispatchCallRequest(request);
    const result = await getDispatchCallStatus({
      driverId,
      driverTokenHash,
      callId: normalizeDispatchCallId(body.callId),
      now: Date.now(),
    });
    return dispatchCallResponse(result);
  } catch (error) {
    return dispatchCallRequestError(error);
  }
}
