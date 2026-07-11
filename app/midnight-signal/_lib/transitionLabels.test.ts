import { describe, expect, test } from "vitest";
import { orderedTransitionLabel } from "./transitionLabels";

describe("orderedTransitionLabel", () => {
  test("names the first actionable transition rather than a later game over", () => {
    expect(
      orderedTransitionLabel(
        [
          { type: "achievement", key: "first-run", name: "Opening Act" },
          { type: "tapeUnlocked", id: "tape-1", title: "Tape 1", order: 1, total: 8 },
          { type: "gameOver", score: 0, round: 1, isPersonalBest: false },
        ],
        ["tape-1"],
      ),
    ).toBe("Open recovered tape");
  });

  test("names Channel 100 before a later terminal event", () => {
    expect(
      orderedTransitionLabel(
        [{ type: "finaleReady" }, { type: "bankExhausted" }],
        [],
      ),
    ).toBe("Continue to Channel 100");
  });

  test("skips a missing tape just like the transition engine", () => {
    expect(
      orderedTransitionLabel(
        [
          { type: "tapeUnlocked", id: "missing", title: "Missing", order: 1, total: 8 },
          { type: "gameOver", score: 0, round: 1, isPersonalBest: false },
        ],
        [],
      ),
    ).toBe("Show final results");
  });
});
