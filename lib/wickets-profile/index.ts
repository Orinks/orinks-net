// A Wicket's player's page: their ranked bests, checked by the server, and
// what their own game sent with its last cloud save (lib/wickets-online
// profile.js). Holiday specials are named only from the specials list kept
// in the site's data, each from its date, so no special's name is in this
// code.
import type { GameRecords } from "@/lib/games/records";
import { profile, type WicketsProfile } from "@/lib/wickets-online";
import { WICKETS_RANKED_GAMES } from "@/lib/wickets-leaderboards";
import { WICKETS_GAME_NAMES } from "./games";

export { WICKETS_GAME_NAMES } from "./games";

export type RankedRow = {
  /** "Safecracker", or "Safecracker, Relaxed pace". */
  label: string;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
};

export type GameRow = { name: string; best: number | null; unlocks: number | null };

export type PlayerPage = {
  name: string;
  ranked: RankedRow[];
  specials: string[];
  fromGame: GameRow[];
};

/** One row of the specials list: the name, and when it may first show. */
export type CatalogEntry = { name: string; showFrom: number };

/** Builds the page from what the boards and card hold. Pure, for tests. */
export function pageFrom(
  name: string,
  found: WicketsProfile | null,
  catalog: Record<string, CatalogEntry | undefined>,
  now: number,
): PlayerPage {
  const ranked: RankedRow[] = [];
  for (const game of WICKETS_RANKED_GAMES) {
    for (const relaxed of game.pace ? [false, true] : [false]) {
      const score = (period: string) =>
        found?.ranked.find((r) => r.game === game.id && r.period === period && r.relaxed === relaxed)?.score ?? null;
      const row = {
        label: relaxed ? `${game.name}, Relaxed pace` : game.name,
        daily: score("daily"),
        weekly: score("weekly"),
        monthly: score("monthly"),
      };
      if (row.daily !== null || row.weekly !== null || row.monthly !== null) ranked.push(row);
    }
  }
  const card = found?.card ?? null;
  const specials = (card?.specials ?? [])
    .map((id) => catalog[id])
    .filter((entry): entry is CatalogEntry => !!entry && typeof entry.name === "string" && entry.showFrom <= now)
    .map((entry) => entry.name);
  const fromGame = Object.entries(card?.games ?? {})
    .filter(([id]) => Object.hasOwn(WICKETS_GAME_NAMES, id))
    .map(([id, entry]) => ({ name: WICKETS_GAME_NAMES[id], best: entry.best ?? null, unlocks: entry.unlocks ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { name, ranked, specials, fromGame };
}

/** The page for `playerId`, read from the game's records. */
export async function readPlayerPage(
  records: GameRecords,
  player: { playerId: string; name: string },
  now: number,
): Promise<PlayerPage> {
  const found = await profile(records, player.playerId, { now: () => now });
  const catalog: Record<string, CatalogEntry | undefined> = {};
  for (const id of found?.card?.specials ?? []) {
    const row = await records.get<CatalogEntry>("catalog", id);
    if (row?.value) catalog[id] = row.value;
  }
  return pageFrom(player.name, found, catalog, now);
}

/** The page's address for a player's name. */
export function playerPath(name: string) {
  return `/wickets/players/${encodeURIComponent(name)}`;
}
