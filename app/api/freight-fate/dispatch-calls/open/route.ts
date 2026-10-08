import {
  dispatchCallRequestError,
  dispatchCallResponse,
  getOpenDispatchCalls,
  parseDispatchCallRequest,
} from "@/lib/freight-fate-dispatch-calls";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { driverId, driverTokenHash } = await parseDispatchCallRequest(request);
    const result = await getOpenDispatchCalls({
      driverId,
      driverTokenHash,
      now: Date.now(),
    });
    return dispatchCallResponse(result);
  } catch (error) {
    return dispatchCallRequestError(error);
  }
}
