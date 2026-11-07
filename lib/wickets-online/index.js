// Wicket's leaderboards, on Hearken's verified runs (@hearken/online).
//
// Every ranked board is a challenge: everyone plays the same safes, deals
// or dives, from a seed made from a secret and handed out only once its
// day, week or month has begun, so nobody can practise a course before it
// opens. The server replays each posted run with the game's own rules and
// ranks only the score it works out itself.
//
// - Daily boards count each player's first run of the day. Weekly and
//   monthly boards keep each player's best.
// - A holiday mode's board shows only in its season, a new board each
//   year, kept readable once the season ends.
// - Practice and tutorials are never posted, so they have no kinds here.

import { createService, refuse } from "../hearken-online/index.js";

import { GAMES } from "./games.js";
import { periodEnd, periodKey, periodStart } from "./periods.js";
import { recordsBoards } from "./records.js";

export { GAMES } from "./games.js";
export { memoryBoards } from "./boards.js";
export { recordsBoards, memoryRecords, rankOrder } from "./records.js";
export { periodKey, periodStart, periodEnd, isoWeek, PERIODS } from "./periods.js";

/** How long after a period ends a run begun in it can still be posted. */
export const GRACE_MS = 2 * 3_600_000;
/** Entries a board answers with. */
export const TOP = 10;

const encoder = new TextEncoder();

/** HMAC-SHA256(secret, text)'s first 8 bytes, as a decimal u64. */
export async function secretSeed(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(mac[i]);
  return n.toString();
}

/** The kinds a game posts, as of `ms`: none for a holiday out of season. */
export function kindsOf(id, game, ms) {
  if (game.season && !game.season.open(ms)) return [];
  return game.periods.map((period) => ({ kind: `${id}-${period}`, id, game, period }));
}

function keyOf(game, period, ms) {
  return period === "season" ? game.season.key(ms) : periodKey(period, ms);
}

function startOf(game, period, ms) {
  return period === "season" ? game.season.start(ms) : periodStart(period, ms);
}

function endOf(game, period, ms) {
  return period === "season" ? game.season.end(ms) : periodEnd(period, ms);
}

/**
 * The handlers for every kind, by kind, for `createService` or orinks.net's
 * games registry. The set follows the clock: a holiday's kinds are there
 * only in its season, and outside it the service answers as if they never
 * existed, though the handlers were made once.
 *
 * @param {object} options
 * @param {object} options.boards    Where entries live: `recordsBoards(records)` on orinks.net.
 * @param {string} options.secret    The seed secret, 32 characters or more. Never published.
 * @param {() => number} [options.now]
 * @param {Record<string, object>} [options.games]  `GAMES` by default.
 */
export function wicketsHandlers(options) {
  const { boards, secret, now = () => Date.now(), games = GAMES } = options;
  if (!secret || secret.length < 32) throw new Error("the seed secret must be at least 32 characters");

  function seedFor(kind, key) {
    return secretSeed(secret, `${kind}:${key}`);
  }

  /** The period a run's seed belongs to: this one, or the last within grace. */
  async function periodOfRun(entry, seed, t) {
    const key = keyOf(entry.game, entry.period, t);
    if ((await seedFor(entry.kind, key)) === seed) return { key, since: startOf(entry.game, entry.period, t) };
    const begun = startOf(entry.game, entry.period, t);
    if (t - begun < GRACE_MS) {
      const before = keyOf(entry.game, entry.period, begun - 1);
      if ((await seedFor(entry.kind, before)) === seed) {
        return { key: before, since: startOf(entry.game, entry.period, begun - 1) };
      }
    }
    return null;
  }

  function handler(entry) {
    const context = { period: entry.period === "season" ? "daily" : entry.period };
    return {
      async start() {
        const t = now();
        const key = keyOf(entry.game, entry.period, t);
        return {
          seed: await seedFor(entry.kind, key),
          context,
          key,
          ends: new Date(endOf(entry.game, entry.period, t)).toISOString(),
        };
      },
      async expect({ run }) {
        const found = await periodOfRun(entry, run.seed, now());
        if (!found) throw refuse("ended", "That challenge has ended.");
        return { rules: entry.game.rules, seed: run.seed, context };
      },
      async accept({ player, verified }) {
        const found = await periodOfRun(entry, verified.seed, now());
        if (!found) throw refuse("ended", "That challenge has ended.");
        const { key, since } = found;
        const board = `${entry.kind}/${key}`;
        const score = Number(entry.game.score(verified.outcome));
        const held = entry.game.burst != null && Number(verified.outcome.burst ?? 0) > entry.game.burst;
        const rule = entry.period === "daily" ? "first" : "best";
        const { counted } = await boards.record(
          board,
          { player: player.id, name: player.name, score, at: now(), since, run: verified.run_id, held },
          rule,
        );
        const { you, of } = await boards.top(board, 0, player.id);
        return { counted, first: rule === "first", key, score, rank: you?.rank ?? null, of, held: you?.held ?? held };
      },
      async read({ path, player }) {
        if (path[0] !== "top" || path.length > 2) return undefined;
        const t = now();
        const current = keyOf(entry.game, entry.period, t);
        const key = path[1] ?? current;
        // Past boards stay readable; boards still to come do not exist yet.
        if (!/^[0-9A-Za-z-]{4,16}$/.test(key) || key > current) return undefined;
        const top = await boards.top(`${entry.kind}/${key}`, TOP, player?.id);
        return { key, current: key === current, ...top };
      },
    };
  }

  const all = {};
  const seasons = {};
  for (const [id, game] of Object.entries(games)) {
    for (const period of game.periods) {
      const entry = { kind: `${id}-${period}`, id, game, period };
      all[entry.kind] = handler(entry);
      seasons[entry.kind] = game.season;
    }
  }
  const open = (kind) => Object.hasOwn(all, kind) && (!seasons[kind] || seasons[kind].open(now()));
  // The service looks kinds up with Object.hasOwn and Object.keys, which
  // both ask for a property's descriptor: out of season there is none.
  return new Proxy(all, {
    has: (target, kind) => open(kind),
    getOwnPropertyDescriptor: (target, kind) =>
      open(kind) ? Object.getOwnPropertyDescriptor(target, kind) : undefined,
    get: (target, kind) => (open(kind) ? target[kind] : undefined),
  });
}

/** Moves a guest's entries to the account it connected to (`onLink`). */
export function linkGuest(boards) {
  return async ({ guest, player }) => {
    if (player) await boards.move(guest, player.id, player.name);
  };
}

/**
 * Wicket's entry for orinks.net's games registry (`GAMES` in
 * lib/games/registry.ts there): boards on the site's records store, seeds
 * from `WICKETS_SEED_SECRET`.
 */
export function wicketsGame({ secret, now, games } = {}) {
  return {
    id: "wickets",
    title: "Wicket's",
    // Read when the service is built, not when the registry loads. Without
    // the secret this throws, and the site answers that games are unavailable.
    handlers: (records) =>
      wicketsHandlers({
        boards: recordsBoards(records),
        secret: secret ?? globalThis.process?.env?.WICKETS_SEED_SECRET,
        now,
        games,
      }),
    // A guest's new name and its move to an account follow it onto the boards.
    guests: (records) => {
      const boards = recordsBoards(records);
      return { renamed: (player, name) => boards.rename(player.id, name), linked: linkGuest(boards) };
    },
  };
}

/**
 * The whole service on its own, for tests and the dev server: the handlers
 * on `createService`, with guests renamed and moved on the boards.
 *
 * @param {object} options  `createService`'s, with `boards`, `secret`, `now` and `games` as above.
 */
export function wicketsService(options) {
  const { boards, basePath = "/api/games/wickets" } = options;
  // A guest's new name follows it onto the boards.
  const accounts = Object.create(options.accounts);
  accounts.renameGuest = async (player) => {
    const name = await options.accounts.renameGuest(player);
    if (name) await boards.rename(player.id, name);
    return name;
  };
  return createService({
    ...options,
    accounts,
    basePath,
    handlers: wicketsHandlers(options),
    onLink: linkGuest(boards),
  });
}
