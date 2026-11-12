import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// The desk's per-driver settings. Body: { driverId, memberDriverId,
// nightDispatcher? (null follows the carrier default), standingRules? }.
export async function PATCH(request: Request) {
  return answerDispatch(
    request,
    { type: "mutation", name: "setMemberSettings" },
    only("memberDriverId", "nightDispatcher", "standingRules"),
  );
}

// Release a driver from the carrier. Body: { driverId, memberDriverId }.
export async function DELETE(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "releaseDriver" }, only("memberDriverId"));
}
