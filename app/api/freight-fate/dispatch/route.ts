import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// A driver's side of live dispatch: their carrier, standing rules and orders,
// and whether this account runs a carrier of its own.
// GET ?driverId=..., Bearer driver token.
export async function GET(request: Request) {
  return answerDispatch(request, { type: "query", name: "getMyDispatch" });
}

// The driver's own switches. Body: { driverId, notesMuted }.
export async function PATCH(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "setMySettings" }, only("notesMuted"));
}
