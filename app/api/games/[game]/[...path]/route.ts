// Every Hearken game's verified runs: /api/games/<game>/runs, /start,
// /activate/start, /activate/poll and the game's own read routes. The
// protocol is Hearken's (docs/online.md in orinks-games/hearken); the game
// itself is in lib/games/registry.ts.
import { GAMES } from "@/lib/games/registry";
import { serviceFor } from "@/lib/games/service";

export const runtime = "nodejs";
// A replay is bounded by the game's own MAX_TICKS; this is the ceiling.
export const maxDuration = 30;

async function handle(request: Request, context: { params: Promise<{ game: string }> }) {
  const { game } = await context.params;
  if (!Object.hasOwn(GAMES, game)) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const service = serviceFor(game, new URL(request.url).origin);
  if (!service) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return service.fetch(request);
}

export { handle as GET, handle as POST };
