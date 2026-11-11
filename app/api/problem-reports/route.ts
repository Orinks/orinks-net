import { createHandler, liveDeps } from "@/lib/problem-reports-handler";

export const runtime = "nodejs";

// The handler lives in lib/problem-reports-handler.ts: a Next route file may
// export only its methods and route config, so createHandler (which the tests
// build with fake mail and DNS) cannot be exported from here.
export const POST = createHandler(liveDeps);
