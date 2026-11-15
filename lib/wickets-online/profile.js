// A player's page on orinks.net: what the boards checked, and what the
// player's own game sent beside its records.
//
// - Ranked bests come from the boards: each board a player has an entry on
//   is in their "p" list (the last 100), and the best score per kind
//   ("safecracker-weekly", "sonar-dive-daily-relaxed") is read from those
//   entries. Held and moved entries never count. A holiday kind counts only
//   while its season is open, so its board stays out of sight otherwise.
// - The card is what the game sent with its last cloud save (see
//   `wicketsSaves`): ids and numbers only, checked by `checkCard`, kept in
//   the "card" collection. The page labels it as sent by the game.

import { refuse } from "../hearken-online/index.js";

import { GAMES } from "./games.js";

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** The most games a card may list. */
export const MAX_CARD_GAMES = 80;
/** The most specials a card may list. */
export const MAX_CARD_SPECIALS = 40;
/** The largest number a card may hold. */
const MAX_NUMBER = 1e12;

function count(n) {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_NUMBER;
}

/**
 * A card as the game sends it, made safe to keep and show: `{ v, games: {
 * <id>: { best?, unlocks? } }, specials: [<id>] }`. Anything else is
 * refused, so no text a player could write reaches a page.
 */
export function checkCard(card) {
  if (!card || typeof card !== "object" || card.v !== 1) throw refuse("bad-card");
  const games = card.games ?? {};
  if (typeof games !== "object" || Array.isArray(games)) throw refuse("bad-card");
  const ids = Object.keys(games);
  if (ids.length > MAX_CARD_GAMES) throw refuse("bad-card");
  const out = {};
  for (const id of ids) {
    const entry = games[id];
    if (!ID.test(id) || !entry || typeof entry !== "object") throw refuse("bad-card");
    const kept = {};
    for (const [field, value] of Object.entries(entry)) {
      if (!["best", "unlocks"].includes(field) || !count(value)) throw refuse("bad-card");
      kept[field] = value;
    }
    out[id] = kept;
  }
  const specials = card.specials ?? [];
  if (!Array.isArray(specials) || specials.length > MAX_CARD_SPECIALS || !specials.every((s) => typeof s === "string" && ID.test(s))) {
    throw refuse("bad-card");
  }
  return { v: 1, games: out, specials: [...new Set(specials)] };
}

/**
 * The `saves` option for `createService`: the records file, sealed, with
 * its card kept for the player's page. Guests keep no saves.
 *
 * @param {object} store    Where revisions live (`memorySaves()`, or the site's).
 * @param {object} records  The site's game records, for the card.
 * @param {() => number} [now]
 */
export function wicketsSaves({ store, records, sealed = true, now = () => Date.now() }) {
  return {
    store,
    guests: false,
    files: { records: { sealed, maxBytes: 512 * 1024, card: (card) => checkCard(card) } },
    onSave: async ({ player, card }) => {
      if (card) await records.put("card", String(player.id), { value: { ...card, at: now() }, playerId: player.id });
    },
  };
}

/** "safecracker-daily-relaxed" -> { game, period, relaxed }, from GAMES. */
function kindOf(kind, games) {
  const relaxed = kind.endsWith("-relaxed");
  const base = relaxed ? kind.slice(0, -"-relaxed".length) : kind;
  for (const [id, game] of Object.entries(games)) {
    for (const period of game.periods) {
      if (base === `${id}-${period}` && (!relaxed || game.relaxed)) return { id, game, period, relaxed };
    }
  }
  return null;
}

/**
 * What the player's page shows: their name, ranked bests by game, period
 * and pace, and their card. `null` for no such player.
 */
export async function profile(records, playerId, { now = () => Date.now(), games = GAMES } = {}) {
  const id = String(playerId);
  const name = await records.get("names", id);
  const index = await records.get("p", id);
  const boards = Array.isArray(index?.value) ? index.value : [];
  const bests = {};
  const t = now();
  for (const board of boards) {
    const [kind] = board.split("/");
    const found = kindOf(kind, games);
    if (!found) continue;
    if (found.game.season && !found.game.season.open(t)) continue;
    const row = await records.get(`b:${board.toLowerCase().replace(/\//g, ":")}`, id);
    const entry = row?.value;
    if (!entry || entry.moved || entry.held || !(row.order > 0)) continue;
    const at = `${found.id}/${found.period}${found.relaxed ? "/relaxed" : ""}`;
    if (!bests[at] || entry.score > bests[at].score) {
      bests[at] = { game: found.id, period: found.period, relaxed: found.relaxed, score: entry.score };
    }
  }
  const card = await records.get("card", id);
  if (!name && boards.length === 0 && !card) return null;
  return {
    name: typeof name?.value === "string" ? name.value : null,
    ranked: Object.values(bests),
    card: card?.value ?? null,
  };
}
