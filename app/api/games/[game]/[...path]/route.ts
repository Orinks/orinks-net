// Every Hearken game's verified runs: /api/games/<game>/runs, /start,
// /activate/start, /activate/poll and the game's own read routes, and its
// rooms (/api/games/<game>/rooms...) and chat moderation
// (/api/games/<game>/moderation), which go to its Durable Object. The
// protocol is Hearken's (docs/online.md in orinks-games/hearken); the game
// itself is in lib/games/registry.ts.
import { GAMES } from "@/lib/games/registry";
import { serviceFor } from "@/lib/games/service";

export const runtime = "nodejs";
// A replay is bounded by the game's own MAX_TICKS; this is the ceiling.
export const maxDuration = 30;

type RoomsNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
};

/** The GameRooms Durable Object binding, on Cloudflare Workers only. */
async function roomsBinding(): Promise<RoomsNamespace | null> {
  try {
    // A variable specifier keeps next build and vitest from resolving the
    // Workers-only module (as lib/spotify-cache.ts does).
    const specifier = "cloudflare:workers";
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      env?: { GAME_ROOMS?: RoomsNamespace };
    };
    return mod.env?.GAME_ROOMS ?? null;
  } catch {
    return null;
  }
}

async function handle(request: Request, context: { params: Promise<{ game: string; path?: string[] }> }) {
  const { game, path } = await context.params;
  if (!Object.hasOwn(GAMES, game)) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  // Matches and chat between players live in the game's own Durable
  // Object (lib/games/rooms-object.js). Without one, the rooms routes
  // answer 404 as before.
  // The owner's chat moderation (lib/games/moderation-route.js) lives in
  // the same object; it checks the server secret itself.
  if (path?.[0] === "rooms" || (path?.[0] === "moderation" && path.length === 1)) {
    const rooms = await roomsBinding();
    if (rooms) {
      // The route's Request is the framework's own object, which a Durable
      // Object stub cannot take: pass it on as a plain URL and init.
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
      return rooms
        .get(rooms.idFromName(game))
        .fetch(request.url, { method: request.method, headers: request.headers, body });
    }
  }
  const service = serviceFor(game, new URL(request.url).origin);
  if (!service) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return service.fetch(request);
}

export { handle as GET, handle as POST };
