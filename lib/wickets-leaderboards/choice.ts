import { PERIODS, WICKETS_RANKED_GAMES, type BoardPace, type Period } from "./index";

/** The game picker's value for every game at once, the overview. */
export const ALL_GAMES = "all";

/** The board a page shows: a game (or ALL_GAMES), a period and, for a game
 * with a Pace setting, which pace's board. */
export type Choice = { game: string; period: Period; pace: BoardPace };

type Search = Record<string, string | string[] | undefined>;

/** A parameter's last value: a form sends the current choice first and the
 * pressed button's after it. */
function last(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

/** The board the address asks for, or today's overview of every game. */
export function choiceFrom(search: Search): Choice {
  const game = WICKETS_RANKED_GAMES.find((g) => g.id === last(search.game));
  const period = (PERIODS as readonly string[]).includes(last(search.board) ?? "")
    ? (last(search.board) as Period)
    : "daily";
  const pace: BoardPace = game?.pace && last(search.pace) === "relaxed" ? "relaxed" : "main";
  return { game: game?.id ?? ALL_GAMES, period, pace };
}

