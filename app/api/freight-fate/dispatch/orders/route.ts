import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// Send a driver an order. Body: { driverId, orderId, memberDriverId, kind,
// payload }. kind is load_offer, route, go_home or note; a repeated orderId
// is answered as a duplicate, so a retry is safe.
export async function POST(request: Request) {
  return answerDispatch(
    request,
    { type: "mutation", name: "postOrder" },
    only("orderId", "memberDriverId", "kind", "payload"),
  );
}

// Take an order back. Body: { driverId, orderId }.
export async function DELETE(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "withdrawOrder" }, only("orderId"));
}
