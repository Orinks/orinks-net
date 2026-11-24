import { describe, expect, test } from "vitest";
import { ordinal, overview, placePoints } from "./overview";

const board = (...names: string[]) => ({
  key: "k",
  endsAt: 0,
  entries: names.map((name, i) => ({ rank: i + 1, name, score: 1000 - i })),
  of: names.length,
});

describe("the all-games overview", () => {
  test("places give 10 points for first down to 1 for tenth", () => {
    expect([1, 2, 10, 11].map(placePoints)).toEqual([10, 9, 1, 0]);
  });

  test("adds each player's points across games, most first", () => {
    const o = overview([
      { game: "safecracker", board: board("Ann", "Bo", "Cy") },
      { game: "belfry", board: board("Cy", "Bo") },
      { game: "sonar-dive", board: board() },
    ]);
    expect(o.games).toBe(2);
    // Level on points: Cy's first place beats Bo's two seconds.
    expect(o.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, "Cy", 18],
      [2, "Bo", 18],
      [3, "Ann", 10],
    ]);
  });

  test("level points go to more first places, and players level on both share a rank", () => {
    const o = overview([
      { game: "safecracker", board: board("Ann", "Bo") },
      { game: "belfry", board: board("Bo", "Ann") },
      { game: "riverboat-dice", board: board("Cy") },
    ]);
    expect(o.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, "Ann", 19],
      [1, "Bo", 19],
      [3, "Cy", 10],
    ]);
    expect(o.entries[0].placings).toEqual([
      { game: "safecracker", rank: 1 },
      { game: "belfry", rank: 2 },
    ]);
  });

  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
  });
});
