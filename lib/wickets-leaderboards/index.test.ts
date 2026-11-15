import { describe, expect, test } from "vitest";
import {
  PERIODS,
  WICKETS_RANKED_GAMES,
  endsPhrase,
  periodEnd,
  periodKey,
  scorePhrase,
  wicketsBoardSource,
  wicketsLeaderboardsShown,
} from "./index";
import { mockBoard } from "./mock";

// Friday, November 13, 2026, 15:30 UTC.
const NOW = Date.UTC(2026, 10, 13, 15, 30);

describe("the preview gate", () => {
  test("the production Worker does not show the pages", () => {
    expect(wicketsLeaderboardsShown({ VERCEL_ENV: "production" })).toBe(false);
  });

  test("a build that does not say which it is counts as production", () => {
    expect(wicketsLeaderboardsShown({})).toBe(false);
  });

  test("the preview Worker shows them", () => {
    expect(wicketsLeaderboardsShown({ VERCEL_ENV: "preview" })).toBe(true);
  });
});

describe("periods", () => {
  test("are keyed and closed as the game keys them, in UTC", () => {
    expect(PERIODS.map((period) => periodKey(period, NOW))).toEqual(["2026-11-13", "2026-W46", "2026-11"]);
    expect(PERIODS.map((period) => new Date(periodEnd(period, NOW)).toISOString())).toEqual([
      "2026-11-14T00:00:00.000Z",
      "2026-11-16T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ]);
  });

  test("an end is written in words with UTC", () => {
    expect(endsPhrase(periodEnd("weekly", NOW))).toBe("Monday, November 16, 00:00 UTC");
    expect(scorePhrase(12480)).toBe("12,480");
  });
});

describe("the sample boards", () => {
  const all = WICKETS_RANKED_GAMES.flatMap((game) =>
    PERIODS.flatMap((period) =>
      (game.pace ? (["main", "relaxed"] as const) : (["main"] as const)).map((pace) => ({
        label: `${game.id} ${period} ${pace}`,
        board: mockBoard(game.id, period, pace, NOW),
      })),
    ),
  );

  test("are the same on every render of a period, and change with the period", async () => {
    const first = await wicketsBoardSource.board("safecracker", "daily", "main", NOW);
    expect(await wicketsBoardSource.board("safecracker", "daily", "main", NOW + 3_600_000)).toEqual(first);
    expect(mockBoard("safecracker", "daily", "main", NOW + 86_400_000).entries).not.toEqual(first.entries);
  });

  test("are shaped as the service's top(): ranks 1 to n, best first, at most ten", () => {
    for (const { label, board } of all) {
      expect(board.entries.length, label).toBeLessThanOrEqual(10);
      expect(board.of, label).toBeGreaterThanOrEqual(board.entries.length);
      expect(board.entries.map((entry) => entry.rank), label).toEqual(board.entries.map((_, i) => i + 1));
      for (let i = 1; i < board.entries.length; i++) {
        expect(board.entries[i].score, label).toBeLessThanOrEqual(board.entries[i - 1].score);
      }
      for (const entry of board.entries) expect(Number.isInteger(entry.score) && entry.score > 0, label).toBe(true);
      expect(new Set(board.entries.map((entry) => entry.name)).size, label).toBe(board.entries.length);
    }
  });

  test("include a full board with more players than shown, a short one, an empty one and a tie", () => {
    const boards = all.map(({ board }) => board);
    expect(boards.some((board) => board.entries.length === 10 && board.of > 10)).toBe(true);
    expect(mockBoard("safecracker", "daily", "relaxed", NOW)).toMatchObject({ of: 7 });
    expect(mockBoard("safecracker", "daily", "relaxed", NOW).entries).toHaveLength(7);
    expect(mockBoard("belfry", "daily", "main", NOW)).toMatchObject({ of: 0, entries: [] });
    expect(
      boards.some((board) => board.entries.some((entry, i) => i > 0 && entry.score === board.entries[i - 1].score)),
    ).toBe(true);
  });

  test("names are guests (two words and a number) or account handles", () => {
    const names = all.flatMap(({ board }) => board.entries.map((entry) => entry.name));
    const guests = names.filter((name) => /^[A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}$/.test(name));
    expect(guests.length).toBeGreaterThan(0);
    expect(guests.length).toBeLessThan(names.length);
  });
});
