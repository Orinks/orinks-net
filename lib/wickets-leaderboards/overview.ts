// All games on one board. Scores in different games are not on one scale
// (Sonar Dive's coins run far higher than Belfry's points), so the overview
// ranks places, not scores: each game's board gives 10 points for first
// place, 9 for second, down to 1 for tenth, and a player's points from every
// game are added up. Only the main boards count: Relaxed pace is a second
// board of the same game, and counting it would give that game twice.

import type { WicketsBoard } from "./index";

/** Points for first place on a game's board; each place below gets one less. */
export const FIRST_PLACE_POINTS = 10;

/** Players the overview shows, as each game's board shows ten. */
export const TOP = 10;

/** A player's place on one game's board. */
export type Placing = { game: string; rank: number };

export type OverviewEntry = {
  rank: number;
  name: string;
  points: number;
  /** Best place first, then by the games' order. */
  placings: Placing[];
};

export type Overview = {
  entries: OverviewEntry[];
  /** Games whose board has at least one score. */
  games: number;
};

export function placePoints(rank: number) {
  return Math.max(0, FIRST_PLACE_POINTS + 1 - rank);
}

/**
 * The overview of `boards`: one board per game, in the games' order, for
 * the same period. Players are told apart by their shown name, the only
 * thing a board gives. Most points come first; on equal points, more first
 * places, then more second places and so on; players still level share a
 * rank and are listed by name.
 */
export function overview(
  boards: { game: string; board: WicketsBoard }[],
): Overview {
  const players = new Map<
    string,
    { name: string; points: number; placings: Placing[] }
  >();
  let games = 0;
  for (const { game, board } of boards) {
    if (board.entries.length > 0) games += 1;
    for (const entry of board.entries) {
      const points = placePoints(entry.rank);
      if (points === 0) continue;
      const player = players.get(entry.name) ?? {
        name: entry.name,
        points: 0,
        placings: [],
      };
      player.points += points;
      player.placings.push({ game, rank: entry.rank });
      players.set(entry.name, player);
    }
  }
  const order = boards.map((b) => b.game);
  const sorted = [...players.values()].map((p) => ({
    ...p,
    placings: [...p.placings].sort(
      (a, b) =>
        a.rank - b.rank || order.indexOf(a.game) - order.indexOf(b.game),
    ),
  }));
  const ranks = (p: { placings: Placing[] }) => p.placings.map((x) => x.rank);
  const level = (a: (typeof sorted)[number], b: (typeof sorted)[number]) => {
    if (a.points !== b.points) return b.points - a.points;
    const ra = ranks(a);
    const rb = ranks(b);
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      // A missing place counts as worse than any place.
      const x = ra[i] ?? Infinity;
      const y = rb[i] ?? Infinity;
      if (x !== y) return x - y;
    }
    return 0;
  };
  sorted.sort((a, b) => level(a, b) || a.name.localeCompare(b.name));
  const entries: OverviewEntry[] = [];
  sorted.forEach((p, i) => {
    const rank =
      i > 0 && level(sorted[i - 1], p) === 0 ? entries[i - 1].rank : i + 1;
    entries.push({
      rank,
      name: p.name,
      points: p.points,
      placings: p.placings,
    });
  });
  return { entries, games };
}

/** "1st", "2nd", "3rd", "4th", "11th". */
export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen
    ? "th"
    : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
      "th");
  return `${n}${suffix}`;
}
