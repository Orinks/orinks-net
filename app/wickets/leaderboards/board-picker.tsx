"use client";

import { useEffect, useState, type MouseEvent } from "react";
import type { BoardPace, Period, WicketsBoard } from "@/lib/wickets-leaderboards";
import { periodEnd } from "@/lib/wickets-leaderboards/periods";
import { ALL_GAMES, type Choice } from "@/lib/wickets-leaderboards/choice";
import { overview } from "@/lib/wickets-leaderboards/overview";
import { BoardTable } from "./board-table";
import { OverviewTable } from "./overview-table";

/** A game and the boards the page has already read: every one on the
 * preview's sample boards, only the one shown on the live site. */
export type PickerGame = {
  id: string;
  name: string;
  pace: boolean;
  boards: Record<Period, Partial<Record<BoardPace, WicketsBoard>>>;
};

export const PERIOD_LABELS: Record<Period, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
};

export const PACE_LABELS: Record<BoardPace, string> = {
  main: "Normal and Quick",
  relaxed: "Relaxed",
};

const PERIODS = Object.keys(PERIOD_LABELS) as Period[];
const PACES = Object.keys(PACE_LABELS) as BoardPace[];

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2";
const button = `inline-flex min-h-10 items-center justify-center rounded-md border border-line-strong px-4 py-2 font-semibold text-ink hover:bg-paper ${focusRing}`;
const pressedButton = `inline-flex min-h-10 items-center justify-center rounded-md border border-action bg-action px-4 py-2 font-semibold text-white ${focusRing}`;

/** "Safecracker, today" or "Sonar Dive, this week, Relaxed pace". */
export function boardTitle(game: PickerGame, period: Period, pace: BoardPace) {
  const when = PERIOD_LABELS[period].toLowerCase();
  return game.pace && pace === "relaxed" ? `${game.name}, ${when}, Relaxed pace` : `${game.name}, ${when}`;
}

/** The game picker, the board buttons and the board they choose. It is a
 * GET form, so without scripts the buttons load the page for that board;
 * with them, the board changes in place and the address follows. */
type Read = { board?: WicketsBoard; failed?: boolean };

/** The service's name for a board, as lib/wickets-leaderboards names it. */
function kindOf(game: string, period: Period, pace: BoardPace) {
  return `${game}-${period}${pace === "relaxed" ? "-relaxed" : ""}`;
}

export function BoardPicker({ games, initial }: { games: PickerGame[]; initial: Choice }) {
  const [choice, setChoice] = useState(initial);
  const [read, setRead] = useState<Record<string, Read>>({});
  const all = choice.game === ALL_GAMES;
  const game = all ? undefined : (games.find((g) => g.id === choice.game) ?? games[0]);
  const pace = game?.pace ? choice.pace : "main";
  // The boards shown: one game's, or every game's main board for the overview.
  const shown = (game ? [game] : games).map((g) => {
    const kind = kindOf(g.id, choice.period, pace);
    return { game: g, kind, board: g.boards[choice.period][pace] ?? read[kind]?.board, failed: read[kind]?.failed };
  });
  const missing = shown.filter((s) => !s.board && !s.failed).map((s) => s.kind);
  const failed = shown.some((s) => s.failed);
  const missingKey = missing.join(" ");

  // A board the page did not bring is read from the service, once.
  useEffect(() => {
    if (!missingKey) return;
    let gone = false;
    for (const kind of missingKey.split(" ")) {
      fetch(`/api/games/wickets/${kind}/top`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((answer: { key: string; entries: WicketsBoard["entries"]; of: number }) => {
          if (gone) return;
          const endsAt = periodEnd(choice.period, Date.now());
          setRead((r) => ({ ...r, [kind]: { board: { key: answer.key, endsAt, entries: answer.entries, of: answer.of } } }));
        })
        .catch(() => {
          if (!gone) setRead((r) => ({ ...r, [kind]: { failed: true } }));
        });
    }
    return () => {
      gone = true;
    };
  }, [missingKey, choice.period]);

  const title = game ? boardTitle(game, choice.period, pace) : `All games, ${PERIOD_LABELS[choice.period].toLowerCase()}`;
  let body;
  if (failed) {
    body = <p>The scores could not be read. Try again later.</p>;
  } else if (missing.length > 0) {
    body = <p>Reading the scores…</p>;
  } else if (game) {
    body = <BoardTable board={shown[0].board!} labelledBy="leaderboard-title" />;
  } else {
    body = (
      <OverviewTable
        endsAt={shown[0].board!.endsAt}
        labelledBy="leaderboard-title"
        names={Object.fromEntries(games.map((g) => [g.id, g.name]))}
        overview={overview(shown.map((s) => ({ game: s.game.id, board: s.board! })))}
      />
    );
  }

  function choose(next: Choice) {
    setChoice(next);
    const params = new URLSearchParams(next.game === ALL_GAMES ? { board: next.period } : { game: next.game, board: next.period });
    const nextGame = games.find((g) => g.id === next.game);
    if (nextGame?.pace && next.pace === "relaxed") params.set("pace", "relaxed");
    window.history.replaceState(null, "", `?${params}`);
  }

  function press(event: MouseEvent<HTMLButtonElement>, next: Choice) {
    event.preventDefault();
    choose(next);
  }

  return (
    <form action="/wickets/leaderboards" method="get">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label className="block font-semibold text-ink" htmlFor="leaderboard-game">
            Game
          </label>
          <select
            className={`mt-2 rounded-md border border-line-strong bg-white px-3 py-2 text-ink ${focusRing}`}
            id="leaderboard-game"
            name="game"
            onChange={(event) => choose({ ...choice, game: event.target.value })}
            value={game?.id ?? ALL_GAMES}
          >
            <option value={ALL_GAMES}>All games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {/* Without scripts the pressed button's value comes after these, and
            the page reads the last value of each. */}
        <input name="board" type="hidden" value={choice.period} />
        <div aria-label="Board" className="flex flex-wrap gap-3" role="group">
          {PERIODS.map((period) => (
            <button
              aria-pressed={choice.period === period}
              className={choice.period === period ? pressedButton : button}
              key={period}
              name="board"
              onClick={(event) => press(event, { ...choice, game: game?.id ?? ALL_GAMES, period })}
              type="submit"
              value={period}
            >
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
        {game?.pace ? (
          <div aria-label="Pace" className="flex flex-wrap gap-3" role="group">
            <input name="pace" type="hidden" value={pace} />
            {PACES.map((p) => (
              <button
                aria-pressed={pace === p}
                className={pace === p ? pressedButton : button}
                key={p}
                name="pace"
                onClick={(event) => press(event, { ...choice, game: game.id, pace: p })}
                type="submit"
                value={p}
              >
                {PACE_LABELS[p]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <h2 className="mb-4 mt-8 text-2xl font-bold text-ink" id="leaderboard-title">
        {title}
      </h2>
      {body}
    </form>
  );
}
