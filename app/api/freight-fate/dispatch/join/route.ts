import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// Join a carrier by the code its dispatcher reads out. Body: { driverId, inviteCode }.
export async function POST(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "joinCarrier" }, only("inviteCode"));
}
