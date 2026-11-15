import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// A driver answers the desk. Body: { driverId, replyId, orderId?, kind,
// payload? }. A repeated replyId is answered as a duplicate.
export async function POST(request: Request) {
  return answerDispatch(
    request,
    { type: "mutation", name: "postReply" },
    only("replyId", "orderId", "kind", "payload"),
  );
}

// The desk has heard these replies. Body: { driverId, replyIds }.
export async function PATCH(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "markRepliesRead" }, only("replyIds"));
}
