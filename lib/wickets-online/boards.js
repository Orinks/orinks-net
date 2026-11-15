// Boards in memory: for tests and the dev server, and the reference for a
// real store (records.js, on orinks.net). Each method says what a store must
// guarantee.

/**
 * A board is named "<kind>/<key>", such as "safecracker-daily/2026-11-06",
 * and holds one entry per player.
 *
 * - `record(board, entry, rule)`: `rule` is "first" (keep the first entry a
 *   player posts) or "best" (keep the higher score). Answers whether the
 *   entry counted, and the player's entry now. Must be atomic per player
 *   and board, so two runs sent at once cannot both count as a first.
 * - `top(board, n, playerId)`: the shown entries (not held back), best
 *   first, ties to whoever posted first, with the player's own entry.
 * - `rename(playerId, name)`: a guest's new name shows on every board.
 * - `move(fromId, toId, toName)`: a guest's entries become the account's,
 *   board by board, by the board's rule.
 */
export function memoryBoards() {
  const boards = new Map(); // board -> Map(playerId -> entry)
  const rules = new Map(); // board -> rule

  function board(name) {
    if (!boards.has(name)) boards.set(name, new Map());
    return boards.get(name);
  }

  function better(a, b) {
    return a.score !== b.score ? a.score > b.score : a.at < b.at;
  }

  function ranked(name) {
    return [...board(name).values()]
      .filter((e) => !e.held)
      .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  }

  return {
    async record(name, entry, rule) {
      rules.set(name, rule);
      const rows = board(name);
      const prior = rows.get(entry.player);
      const counts = !prior || (rule === "best" && entry.score > prior.score);
      if (counts) rows.set(entry.player, { ...entry });
      return { counted: counts, entry: rows.get(entry.player) };
    },
    async top(name, n, playerId) {
      const all = ranked(name);
      const entries = all.slice(0, n).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score }));
      const at = playerId ? all.findIndex((e) => e.player === playerId) : -1;
      const own = playerId ? board(name).get(playerId) : undefined;
      const you = own
        ? { rank: at >= 0 ? at + 1 : null, score: own.score, held: Boolean(own.held) }
        : null;
      return { entries, of: all.length, you };
    },
    async rename(playerId, name) {
      for (const rows of boards.values()) {
        const e = rows.get(playerId);
        if (e) e.name = name;
      }
    },
    async move(fromId, toId, toName) {
      for (const [name, rows] of boards) {
        const from = rows.get(fromId);
        if (!from) continue;
        rows.delete(fromId);
        const to = rows.get(toId);
        const rule = rules.get(name) ?? "best";
        const keep = !to || (rule === "best" ? better(from, to) : from.at < to.at);
        if (keep) rows.set(toId, { ...from, player: toId, name: toName });
      }
    },
  };
}
