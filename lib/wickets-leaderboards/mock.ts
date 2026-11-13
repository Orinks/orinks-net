// Sample boards for the leaderboard pages until the service is live. Every
// board is drawn from a generator seeded with its game, pace and period key,
// so a page shows the same names and scores on every render of that period.
// Belfry's daily board is always empty and Safecracker's Relaxed daily board
// always has fewer than ten players, so both of those states can be seen.

import type { BoardPace, WicketsBoard, WicketsBoardSource, WicketsGameId } from "./index";
import { periodEnd, periodKey, periodStart, type Period } from "./periods";

const TOP = 10;

const ADJECTIVES = [
  "Copper", "Quiet", "Amber", "Brisk", "Velvet", "Mossy", "Silver", "Dusty",
  "Gentle", "Hollow", "Lucky", "Rusty", "Sunny", "Tidy", "Patient", "Clever",
  "Nimble", "Plain", "Steady", "Wry",
];

const ANIMALS = [
  "Fox", "Heron", "Otter", "Badger", "Wren", "Finch", "Marten", "Hare",
  "Newt", "Plover", "Moth", "Beetle", "Pike", "Lark", "Vole", "Toad",
];

const HANDLES = [
  "marlow_keys", "TinLantern", "quillfeather", "ByTheDock", "sable_and_ink",
  "low_tide_lou", "Pennywhistle", "cobble_stone", "HalfPastNine", "dovetail",
  "bramble_jam", "OddSocks", "kettle_drum", "Ninefold", "paper_kite",
  "slow_canal", "Thimbleworth", "rook_and_rye", "LampPost7", "fen_walker",
];

/** Top scores each game's boards start near: higher is better. */
const TOP_SCORE: Record<WicketsGameId, [number, number]> = {
  safecracker: [9_000, 14_000],
  belfry: [2_400, 3_600],
  "fireside-patience": [6_000, 9_500],
  "riverboat-dice": [1_100, 1_900],
  "sonar-dive": [18_000, 27_000],
};

/** How many players a board holds: [fewest, most]. */
const PLAYERS: Record<BoardPace, Record<Period, [number, number]>> = {
  main: { daily: [12, 60], weekly: [40, 160], monthly: [90, 400] },
  relaxed: { daily: [6, 9], weekly: [14, 30], monthly: [30, 70] },
};

function fixedSize(game: WicketsGameId, period: Period, pace: BoardPace) {
  if (game === "belfry" && period === "daily" && pace === "main") return 0;
  if (game === "safecracker" && period === "daily" && pace === "relaxed") return 7;
  return undefined;
}

/** FNV-1a: a string to a 32-bit seed. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator answering in [0, 1). */
function generator(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function between(random: () => number, [low, high]: [number, number]) {
  return low + Math.floor(random() * (high - low + 1));
}

function pick<T>(random: () => number, list: readonly T[]) {
  return list[Math.floor(random() * list.length)];
}

function names(random: () => number, count: number) {
  const taken = new Set<string>();
  const out: string[] = [];
  while (out.length < count) {
    const name =
      random() < 0.45
        ? pick(random, HANDLES)
        : `${pick(random, ADJECTIVES)} ${pick(random, ANIMALS)} ${between(random, [1, 99])}`;
    if (!taken.has(name)) {
      taken.add(name);
      out.push(name);
    }
  }
  return out;
}

export function mockBoard(game: WicketsGameId, period: Period, pace: BoardPace, now: number): WicketsBoard {
  const key = periodKey(period, now);
  const endsAt = periodEnd(period, now);
  const random = generator(hash(`${game}/${pace}/${key}`));
  const of = fixedSize(game, period, pace) ?? between(random, PLAYERS[pace][period]);
  const shown = Math.min(of, TOP);

  const scale = pace === "relaxed" ? 0.7 : 1;
  let score = Math.round(between(random, TOP_SCORE[game]) * scale);
  const start = periodStart(period, now);
  const players = names(random, shown);
  const rows = players.map((name, i) => {
    if (i > 0) score -= 1 + Math.floor(random() * score * 0.06);
    return { name, score: Math.max(score, 1), at: start + between(random, [0, endsAt - start - 1]) };
  });

  // One tie a board: two players on the same score, whoever posted first ahead.
  if (rows.length >= 2) {
    const i = between(random, [1, rows.length - 1]);
    rows[i].score = rows[i - 1].score;
  }

  rows.sort((a, b) => b.score - a.score || a.at - b.at);
  return { key, endsAt, entries: rows.map((row, i) => ({ rank: i + 1, name: row.name, score: row.score })), of };
}

export const mockBoards: WicketsBoardSource = {
  async board(game, period, pace, now) {
    return mockBoard(game, period, pace, now);
  },
};
