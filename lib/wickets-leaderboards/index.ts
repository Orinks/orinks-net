import { mockBoards } from "./mock";
import type { Period } from "./periods";

export { PERIODS, periodEnd, periodKey, type Period } from "./periods";

/** The games with ranked boards. A game with `pace` has a Pace setting: its
 * Relaxed pace keeps a board of its own, Normal and Quick share the main one. */
export const WICKETS_RANKED_GAMES = [
  { id: "safecracker", name: "Safecracker", pace: true },
  { id: "belfry", name: "Belfry", pace: false },
  { id: "fireside-patience", name: "Fireside Patience", pace: false },
  { id: "riverboat-dice", name: "Riverboat Dice", pace: false },
  { id: "sonar-dive", name: "Sonar Dive", pace: true },
] as const;

export type WicketsRankedGame = (typeof WICKETS_RANKED_GAMES)[number];
export type WicketsGameId = WicketsRankedGame["id"];

/** Which board of a period: the main one, or Relaxed pace's own. */
export type BoardPace = "main" | "relaxed";

export function wicketsRankedGame(id: string): WicketsRankedGame | undefined {
  return WICKETS_RANKED_GAMES.find((game) => game.id === id);
}

/** One period's board, shaped as the service's `top()` answers it, with the
 * period it belongs to. `of` counts every shown entry, not just `entries`. */
export type WicketsBoard = {
  key: string;
  endsAt: number;
  entries: { rank: number; name: string; score: number }[];
  of: number;
};

/** Where boards come from. The mock fills in until the service is live. */
export type WicketsBoardSource = {
  board(game: WicketsGameId, period: Period, pace: BoardPace, now: number): Promise<WicketsBoard>;
};

export const wicketsBoardSource: WicketsBoardSource = mockBoards;

/** The leaderboard pages show their sample boards on the preview only.
 * Production is told apart the way robots.txt does it: VERCEL_ENV, set per
 * Worker in cloudflare.config.ts, and a missing value counts as production. */
export function wicketsLeaderboardsShown(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "production";
}

const ENDS_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const SCORE = new Intl.NumberFormat("en-US");

/** "Sunday, November 15, 00:00 UTC". */
export function endsPhrase(ms: number) {
  const d = new Date(ms);
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${ENDS_DAY.format(d)}, ${time} UTC`;
}

/** "12,480". */
export function scorePhrase(score: number) {
  return SCORE.format(score);
}
