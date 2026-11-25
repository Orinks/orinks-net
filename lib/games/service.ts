// One @hearken/online service per game, built on first use and kept for
// the life of the function instance.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createService, memoryLimiter, publishedRules, refuse } from "@/lib/hearken-online";
import type { Handler, Player, PublishedRules, RoomStore, ServiceOptions } from "@/lib/hearken-online";
import { getConvexClient } from "@/lib/convex";
import { site } from "@/lib/site";
import { clientIp } from "@/lib/client-ip";
import { convexRecords } from "./records";
import { GAMES, type GameDefinition } from "./registry";
import { convexSaves, convexStores, gamesServerSecret, type GameStores } from "./stores";

type Service = { fetch(request: Request): Promise<Response> };

/** Running as a Cloudflare Worker, where there is no disk to read. */
function onWorkers() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * Every module in hearken-rules/<game>/, as the game's published builds:
 * read from disk, or on Cloudflare Workers bundled into the Worker at
 * build time, already compiled (scripts/hearken-rules-plugin.mjs).
 */
export function rulesFolder(game: string, root = process.cwd()): PublishedRules {
  let loaded: Promise<PublishedRules> | null = null;
  const load = () => {
    loaded ??= (async () => {
      if (onWorkers()) {
        // webpackIgnore: `next build` has no such module and never runs here.
        const bundled = (await import(/* webpackIgnore: true */ "virtual:hearken-rules")).default;
        const list = bundled[game] ?? [];
        return publishedRules(list);
      }
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
    // The build a new match in a room is played with (lib/hearken-online/rules.js).
    forRules: async (name) => (await load()).forRules?.(name) ?? null,
  };
}

/**
 * GET /api/games/<game>/tester: whether the connected player tests the game
 * (convex/games.ts, setTester), so it can open what it holds back. Every
 * game has it; a player who is not connected is not a tester.
 */
/**
 * A game's handlers plus the tester read. Not a spread: a game's handlers
 * can be a proxy whose kinds open and close by date (Wicket's holiday
 * boards), and a copy would keep the ones open when the service was built.
 */
export function withTester(handlers: Record<string, Handler>): Record<string, Handler> {
  return new Proxy(handlers, {
    has: (target, kind) => kind === "tester" || Reflect.has(target, kind),
    ownKeys: (target) => ["tester", ...Reflect.ownKeys(target).filter((k) => k !== "tester")],
    getOwnPropertyDescriptor: (target, kind) =>
      kind === "tester"
        ? { value: testerHandler, enumerable: true, configurable: true, writable: false }
        : Reflect.getOwnPropertyDescriptor(target, kind),
    get: (target, kind) => (kind === "tester" ? testerHandler : Reflect.get(target, kind)),
  });
}

export const testerHandler: Handler = {
  expect() {
    throw refuse("not-a-run", "Nothing is sent here.");
  },
  accept() {
    return null;
  },
  read({ player }) {
    return { tester: (player as (Player & { tester?: boolean }) | null)?.tester === true };
  },
};

export function buildService(
  game: GameDefinition,
  parts: {
    rules: PublishedRules;
    stores: GameStores;
    records: Parameters<GameDefinition["handlers"]>[0];
    /** Matches and chat between players (lib/games/rooms-object.js). */
    rooms?: RoomStore;
    /** A secret mixed into every player's handle in rooms. */
    handleKey?: string;
    /** Chat screening, reports and standing (lib/games/chat-moderation.js). */
    moderation?: Pick<ServiceOptions, "screen" | "report" | "standing">;
  },
): Service {
  const guests = game.guests?.(parts.records);
  const { createGuest, renameGuest, ...accounts } = parts.stores.accounts;
  if (guests && createGuest && renameGuest) {
    Object.assign(accounts, {
      createGuest,
      async renameGuest(player: Player) {
        const name = await renameGuest(player);
        if (name) await guests.renamed?.(player, name);
        return name;
      },
    });
  }
  const { saves: saveStore, ...stores } = parts.stores;
  return createService({
    rules: parts.rules,
    ...stores,
    accounts,
    saves: saveStore && game.saves ? game.saves(parts.records, saveStore) : null,
    onLink: guests?.linked,
    handlers: withTester(game.handlers(parts.records)),
    rooms: parts.rooms ?? null,
    handleKey: parts.handleKey,
    ...(parts.moderation ?? {}),
    basePath: `/api/games/${game.id}`,
    // The address the platform's edge saw (lib/client-ip.ts), as the Freight
    // Fate routes read it.
    clientKey: (request) => clientIp(request) ?? "unknown",
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
  let service: Service;
  try {
    service = build(game, id, client, secret, origin);
  } catch (error) {
    // A game missing a setting of its own, such as a seed secret.
    console.warn("games", id, "unavailable", String(error));
    return null;
  }
  services.set(id, service);
  return service;
}

function build(
  game: GameDefinition,
  id: string,
  client: NonNullable<ReturnType<typeof getConvexClient>>,
  secret: string,
  origin: string,
): Service {
  return buildService(game, {
    rules: rulesFolder(id),
    // The live site names itself, so a first request to a deployment URL
    // cannot make every game speak that host; previews use their own.
    stores: {
      ...convexStores({
        client,
        secret,
        game: id,
        connectUrl: `${process.env.VERCEL_ENV === "production" ? site.url : origin}/games/connect`,
      }),
      saves: convexSaves(client, secret, id),
    },
    records: convexRecords(client, secret, id),
  });
}

/**
 * The service for `id` with rooms: matches and chat between players, kept
 * in `rooms` (the GameRooms Durable Object's SQLite). A player's token is
 * looked up in Convex once and then remembered for a few minutes, since a
 * match polls every couple of seconds; rate limits are counted in memory,
 * as one Durable Object serves all of a game's rooms. Null when there is no
 * such game or no backend, as for `serviceFor`.
 */
export function roomsServiceFor(
  id: string,
  origin: string,
  rooms: RoomStore,
  moderation?: Pick<ServiceOptions, "screen" | "report" | "standing">,
): (Service & { warm(token: string): Promise<unknown> }) | null {
  if (!Object.hasOwn(GAMES, id)) return null;
  const client = getConvexClient();
  const secret = gamesServerSecret();
  if (!client || !secret) return null;
  const game = GAMES[id];
  const stores = convexStores({
    client,
    secret,
    game: id,
    connectUrl: `${process.env.VERCEL_ENV === "production" ? site.url : origin}/games/connect`,
  });
  const accounts = rememberedAccounts(stores.accounts);
  try {
    const service = buildService(game, {
      rules: rulesFolder(id),
      stores: { ...stores, accounts, limiter: memoryLimiter() },
      records: convexRecords(client, secret, id),
      rooms,
      handleKey: `rooms:${secret}`,
      moderation,
    });
    // Looks the player up ahead of the request (lib/games/rooms-object.js).
    return { fetch: (request) => service.fetch(request), warm: (token) => accounts.player(token) };
  } catch (error) {
    console.warn("games", id, "rooms unavailable", String(error));
    return null;
  }
}

/** How long a token's player is remembered by the rooms service. */
export const REMEMBER_PLAYER_MS = 5 * 60_000;

/** `accounts` with `player(token)` remembered for a while; the rest as is. */
export function rememberedAccounts(
  accounts: GameStores["accounts"],
  { ttlMs = REMEMBER_PLAYER_MS, now = () => Date.now(), max = 5_000 } = {},
): GameStores["accounts"] {
  const known = new Map<string, { player: Player | null; until: number }>();
  return {
    ...accounts,
    async player(token) {
      const t = now();
      const hit = known.get(token);
      if (hit && hit.until > t) return hit.player;
      const player = await accounts.player(token);
      if (known.size >= max) known.clear();
      // A token that answers no one is asked about again sooner.
      known.set(token, { player, until: t + (player ? ttlMs : 10_000) });
      return player;
    },
  };
}
