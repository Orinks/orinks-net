import { describe, expect, test } from "vitest";
import {
  dateKeyOf,
  difficultyRange,
  runRoll,
  seededRandom,
  weekKeyOf,
} from "./triviaDeterminism";

describe("trivia determinism", () => {
  test("uses UTC boundaries for date and ISO week keys", () => {
    expect(dateKeyOf(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
    expect(dateKeyOf(Date.UTC(2025, 11, 31, 23, 59, 59))).toBe("2025-12-31");
    expect(weekKeyOf(Date.UTC(2026, 0, 1))).toBe("2026-W01");
    expect(weekKeyOf(Date.UTC(2027, 0, 1))).toBe("2026-W53");
  });

  test("repeats seeded rolls without sharing mutable generator state", () => {
    const first = seededRandom("night-signal")();
    expect(seededRandom("night-signal")()).toBe(first);
    expect(seededRandom("another-night")()).not.toBe(first);
    expect(runRoll({ isDaily: true, seed: "daily" }, "question", () => 0.99)).toBe(
      runRoll({ isDaily: true, seed: "daily" }, "question", () => 0.01),
    );
    expect(runRoll({ isDaily: false, seed: "free" }, "question", () => 0.37)).toBe(0.37);
  });

  test("keeps the existing round difficulty bands", () => {
    expect(difficultyRange(1)).toEqual([1, 2]);
    expect(difficultyRange(4)).toEqual([1, 3]);
    expect(difficultyRange(7)).toEqual([2, 4]);
    expect(difficultyRange(8)).toEqual([3, 5]);
  });
});
