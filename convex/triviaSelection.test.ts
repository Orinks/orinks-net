import { describe, expect, test } from "vitest";
import type { BankQuestion } from "./questionBank";
import { runRoll } from "./triviaDeterminism";
import { pickQuestion } from "./triviaSelection";

function candidate(id: string, difficulty: number, answer: number): BankQuestion {
  return {
    id,
    category: "Music",
    difficulty,
    prompt: id,
    choices: ["A", "B", "C", "D"],
    answer,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    seed: "daily-2026-07-10",
    isDaily: true,
    round: 1,
    askedQuestionKeys: [],
    roundCategory: "Music",
    mutatorKey: undefined,
    activeRoundBoost: undefined,
    ...overrides,
  };
}

describe("question selection", () => {
  test("uses the frozen candidate order for planned daily episodes", () => {
    const questions = [candidate("first", 2, 0), candidate("second", 2, 1)];
    expect(pickQuestion(run(), questions, true)?.id).toBe("first");
    expect(pickQuestion(run({ askedQuestionKeys: ["first"] }), questions, true)?.id).toBe(
      "second",
    );
  });

  test("keeps seeded legacy selection behavior when no plan is linked", () => {
    const questions = [candidate("first", 2, 0), candidate("second", 2, 1)];
    const legacyRun = run();
    const expected = questions[Math.floor(runRoll(legacyRun, "0") * questions.length)];
    expect(pickQuestion(run(), questions, false)?.id).toBe(
      expected.id,
    );
    expect(pickQuestion(run(), questions, false)?.id).toBe(
      pickQuestion(run(), questions, false)?.id,
    );
  });
});
