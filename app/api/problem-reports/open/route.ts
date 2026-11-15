import { createOpenHandler, liveDeps } from "@/lib/problem-reports-handler";

export const runtime = "nodejs";

// The game's logs, sent ahead of the web form; see lib/problem-reports-handler.ts.
export const POST = createOpenHandler(liveDeps);
