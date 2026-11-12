import { answerDispatch } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// Leave the carrier at once; the driver's queue is cleared. Body: { driverId }.
export async function POST(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "leaveCarrier" });
}
