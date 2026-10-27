// One @hearken/online service per game, built on first use and kept for
// the life of the function instance.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createService, publishedRules } from "@/lib/hearken-online";
import type { PublishedRules } from "@/lib/hearken-online";
import { getConvexClient } from "@/lib/convex";
import { site } from "@/lib/site";
import { convexRecords } from "./records";
import { GAMES, type GameDefinition } from "./registry";
import { convexStores, gamesServerSecret, type GameStores } from "./stores";

type Service = { fetch(request: Request): Promise<Response> };

/** Every module in hearken-rules/<game>/, as the game's published builds. */
export function rulesFolder(game: string, root = process.cwd()): PublishedRules {
  let loaded: Promise<PublishedRules> | null = null;
  const load = () => {
    loaded ??= (async () => {
      const dir = join(root, "hearken-rules", game);
      const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".wasm"));
      const list = await Promise.all(names.map(async (n) => ({ bytes: new Uint8Array(await readFile(join(dir, n))) })));
      return publishedRules(list);
    })().catch((error) => {
      loaded = null;
      throw error;
    });
    return loaded;
  };
  return {
    get: async (build) => (await load()).get(build),
    builds: async () => (await load()).builds(),
  };
}

export function buildService(
  game: GameDefinition,
  parts: { rules: PublishedRules; stores: GameStores; records: Parameters<GameDefinition["handlers"]>[0] },
): Service {
  return createService({
    rules: parts.rules,
    ...parts.stores,
    handlers: game.handlers(parts.records),
    basePath: `/api/games/${game.id}`,
    // Vercel puts the caller's address first and is the only proxy, so the
    // first entry is the one it saw (as the Freight Fate routes read it).
    clientKey: (request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown",
    log: (event) => console.warn("games", game.id, event),
  });
}

const services = new Map<string, Service>();

/** The service for `id`, or null when there is no such game or no backend. */
export function serviceFor(id: string, origin: string): Service | null {
  if (!Object.hasOwn(GAMES, id)) return null;
  const cached = services.get(id);
  if (cached) return cached;
  const client = getConvexClient();
  const secret = gamesServerSecret();
  if (!client || !secret) return null;
  const game = GAMES[id];
  const service = buildService(game, {
    rules: rulesFolder(id),
    // The live site names itself, so a first request to a deployment URL
    // cannot make every game speak that host; previews use their own.
    stores: convexStores({
      client,
      secret,
      game: id,
      connectUrl: `${process.env.VERCEL_ENV === "production" ? site.url : origin}/games/connect`,
    }),
    records: convexRecords(client, secret, id),
  });
  services.set(id, service);
  return service;
}
