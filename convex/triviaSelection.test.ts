import { describe, expect, test } from "vitest";
import type { BankQuestion } from "./questionBank";
import { runRoll } from "./triviaDeterminism";
import { pickQuestion } from "./triviaSelection";

function candidate(
  id: string,
  difficulty: BankQuestion["difficulty"],
  answer: BankQuestion["answer"],
): BankQuestion {
  return {
    id,
    category: "Music",
    difficulty,
    format: "award-desk",
    prompt: id,
    choices: ["A", "B", "C", "D"],
    answer,
    explanation: `Official explanation for ${id}.`,
    source: {
      publisher: "Library of Congress",
      title: `Official source for ${id}`,
      url: `https://www.loc.gov/item/${id}/`,
      accessedAt: "2026-07-10",
      evidenceSummary: `The official record supports ${id}.`,
    },
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

  test("balances planned answer positions by selecting a different question, not reordering choices", () => {
    const questions = [
      candidate("already-asked", 2, 0),
      candidate("earlier-in-plan", 2, 0),
      candidate("balanced-pick", 2, 1),
    ];
    const selected = pickQuestion(
      run({ askedQuestionKeys: ["already-asked"] }),
      questions,
      true,
    );

    expect(selected?.id).toBe("balanced-pick");
    expect(selected?.choices).toEqual(["A", "B", "C", "D"]);
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
