import { createSendHandler, liveDeps } from "@/lib/problem-reports-handler";

export const runtime = "nodejs";

const send = createSendHandler(liveDeps);

// What the player wrote on /report/<code>; see lib/problem-reports-handler.ts.
export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  return send(request, (await context.params).code);
}
