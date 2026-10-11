import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import { getFreightFatePresenceBoardSnapshot } from "@/lib/freight-fate-online";
import { answerPresencePost } from "@/convex/freightFateRequest";

export const runtime = "nodejs";

// The game's heartbeats normally never reach this: next.config.ts rewrites
// authenticated presence requests to the Convex HTTP router. This answers for
// a deployment without that rewrite, the same way.
export async function POST(request: Request) {
  const client = getConvexClient();

  if (!client) {
    return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
  }

  return answerPresencePost(request, (args) => client.mutation(anyApi.freightFate.updatePresence, args));
}

// Public and unauthenticated, so its call volume is whatever the internet
// decides: read from the shared snapshot rather than the backend, or a single
// impatient poller costs a backend query per request. `no-store` still stops
// the game and browsers holding a roster past its stamp. Vercel's own CDN may
// reuse a reply for thirty seconds, so the games polling the board share one
// function call per region instead of making one each; the board is already a
// sixty-second snapshot, so that adds at most half a poll of age.
export async function GET() {
  const board = await getFreightFatePresenceBoardSnapshot();

  if (!board) {
    return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
  }

  return NextResponse.json(board, {
    headers: {
      "cache-control": "no-store",
      "vercel-cdn-cache-control": "max-age=30",
    },
  });
}
