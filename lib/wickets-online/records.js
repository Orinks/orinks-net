// Boards on orinks.net's game records (lib/games/records.ts there, kept in
// convex/games.ts), so Wicket's needs no tables of its own. The records
// store keeps a JSON value under a collection and key, ordered by a number,
// with `putBest` as its one atomic step. A board here is three collections:
//
// - "b:<board>", one record per player, ordered by rank: the score plus a
//   fraction that is larger the earlier the run, so ties go to whoever
//   posted first. Held entries and entries moved to an account are kept
//   below zero, out of the board's ranks.
// - "c:<board>", one claim per player, written with `putBest`: by time for
//   a daily board (the earliest run wins), by rank for the others. Only the
//   run that wins its claim reaches the board.
// - "names", each player's name, read when a board is shown, so a guest's
//   new name shows everywhere at once.
//
// "p", per player, lists the boards they have entries on, so a guest's
// entries can follow them to an account. It keeps the last 100 boards.

/** Seconds into its period a run can be and still rank by time. */
const SPAN = 1e7;
const BOARDS_KEPT = 100;
/** Below every shown entry: where a moved entry goes. */
const GONE = -1e15;

/** A board's name as a records collection: lowercase, no slash. */
function collection(prefix, board) {
  return `${prefix}:${board.toLowerCase().replace(/\//g, ":")}`;
}

/** The order an entry ranks by: its score, ties to the earlier run. */
export function rankOrder(entry) {
  const seconds = Math.min(Math.max((entry.at - (entry.since ?? 0)) / 1000, 0), SPAN - 1);
  return entry.score + 1 - seconds / SPAN;
}

/**
 * The boards contract of `memoryBoards`, on a `GameRecords` store.
 *
 * Two runs from one player that land in the same instant both pass their
 * claims only if each beats the other's, which cannot happen; the board
 * write that follows is plain, so the two can at worst swap which of
 * those near-identical entries shows.
 */
export function recordsBoards(records) {
  async function nameOf(playerId, fallback) {
    const row = await records.get("names", playerId);
    return typeof row?.value === "string" ? row.value : fallback;
  }

  async function remember(playerId, board) {
    const row = await records.get("p", playerId);
    const list = Array.isArray(row?.value) ? row.value : [];
    if (list.includes(board)) return;
    await records.put("p", playerId, { value: [...list, board].slice(-BOARDS_KEPT), playerId });
  }

  async function place(board, entry, rule) {
    const order = rankOrder(entry);
    const kept = await records.putBest(
      collection("c", board),
      entry.player,
      { value: { run: entry.run ?? null }, order: rule === "first" ? entry.at : order, playerId: entry.player },
      { ascending: rule === "first" },
    );
    // A run sent again after its reply was lost has already won its claim.
    let counted = kept;
    if (!kept && entry.run) {
      const claim = await records.get(collection("c", board), entry.player);
      counted = claim?.value?.run === entry.run;
    }
    if (counted) {
      const value = {
        score: entry.score,
        at: entry.at,
        since: entry.since ?? 0,
        run: entry.run ?? null,
        held: Boolean(entry.held),
        rule,
      };
      await records.put(collection("b", board), entry.player, {
        value,
        order: entry.held ? -order : order,
        playerId: entry.player,
      });
      await remember(entry.player, board);
    }
    return counted;
  }

  return {
    async record(board, entry, rule) {
      if (entry.name) await records.put("names", entry.player, { value: entry.name, playerId: entry.player });
      const counted = await place(board, entry, rule);
      const row = await records.get(collection("b", board), entry.player);
      return { counted, entry: row ? { player: entry.player, ...row.value } : null };
    },

    async top(board, n, playerId) {
      const name = collection("b", board);
      const rows = n > 0 ? (await records.list(name, { limit: n })).filter((r) => r.order > 0) : [];
      const entries = await Promise.all(
        rows.map(async (r, i) => ({ rank: i + 1, name: await nameOf(r.key, "?"), score: r.value.score })),
      );
      const of = await records.ahead(name, 0);
      let you = null;
      if (playerId) {
        const own = await records.get(name, playerId);
        if (own && !own.value?.moved) {
          you = {
            rank: own.order > 0 ? (await records.ahead(name, own.order)) + 1 : null,
            score: own.value.score,
            held: Boolean(own.value.held),
          };
        }
      }
      return { entries, of, you };
    },

    async rename(playerId, name) {
      await records.put("names", playerId, { value: name, playerId });
    },

    async move(fromId, toId, toName) {
      await records.put("names", toId, { value: toName, playerId: toId });
      const index = await records.get("p", fromId);
      for (const board of Array.isArray(index?.value) ? index.value : []) {
        const from = await records.get(collection("b", board), fromId);
        if (!from || from.value?.moved) continue;
        const { rule, ...entry } = from.value;
        await place(board, { ...entry, player: toId }, rule ?? "best");
        await records.put(collection("b", board), fromId, { value: { moved: true }, order: GONE, playerId: fromId });
      }
    },
  };
}

/**
 * A `GameRecords` store in memory that answers as convex/games.ts does on
 * orinks.net, collection names and all: for tests and the dev server.
 */
export function memoryRecords() {
  const rows = new Map(); // collection -> Map(key -> record)
  const check = (c, key) => {
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(c) || !key || key.length > 128) throw new Error(`bad record ${c} ${key}`);
  };
  const of = (c) => {
    if (!rows.has(c)) rows.set(c, new Map());
    return rows.get(c);
  };
  const sorted = (c, ascending) =>
    [...of(c).values()].filter((r) => r.order != null).sort((a, b) => (ascending ? a.order - b.order : b.order - a.order));
  const copy = (r) => (r ? structuredClone(r) : null);
  return {
    async get(c, key) {
      return copy(of(c).get(key));
    },
    async put(c, key, { value, order, playerId }) {
      check(c, key);
      of(c).set(key, { key, playerId: playerId ?? null, order: order ?? null, value: structuredClone(value ?? null) });
    },
    async putBest(c, key, { value, order, playerId }, { ascending } = {}) {
      check(c, key);
      const stored = of(c).get(key)?.order;
      if (stored != null && !(ascending ? order < stored : order > stored)) return false;
      of(c).set(key, { key, playerId: playerId ?? null, order, value: structuredClone(value ?? null) });
      return true;
    },
    async list(c, { limit = 10, ascending } = {}) {
      return sorted(c, ascending).slice(0, Math.min(Math.max(1, limit), 100)).map(copy);
    },
    async ahead(c, order, { ascending } = {}) {
      return Math.min(sorted(c, ascending).filter((r) => (ascending ? r.order < order : r.order > order)).length, 1000);
    },
  };
}
