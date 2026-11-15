"use client";

import { useState, type MouseEvent } from "react";
import type { BoardPace, Period, WicketsBoard } from "@/lib/wickets-leaderboards";
import type { Choice } from "@/lib/wickets-leaderboards/choice";
import { BoardTable } from "./board-table";

/** A game and every board it keeps, as the page read them. */
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
export function BoardPicker({ games, initial }: { games: PickerGame[]; initial: Choice }) {
  const [choice, setChoice] = useState(initial);
  const game = games.find((g) => g.id === choice.game) ?? games[0];
  const pace = game.pace ? choice.pace : "main";
  const board = game.boards[choice.period][pace];

  function choose(next: Choice) {
    setChoice(next);
    const params = new URLSearchParams({ game: next.game, board: next.period });
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
            value={game.id}
          >
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
              onClick={(event) => press(event, { ...choice, game: game.id, period })}
              type="submit"
              value={period}
            >
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
        {game.pace ? (
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
        {boardTitle(game, choice.period, pace)}
      </h2>
      {board ? <BoardTable board={board} labelledBy="leaderboard-title" /> : null}
    </form>
  );
}
