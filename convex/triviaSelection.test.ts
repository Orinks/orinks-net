import { describe, expect, test } from "vitest";
import type { BankQuestion } from "./questionBank";
import { runRoll } from "./triviaDeterminism";
import { pickQuestion } from "./triviaSelection";

function candidate(
  id: string,
  difficulty: BankQuestion["difficulty"],
  answer: BankQuestion["answer"],
  format: BankQuestion["format"] = "award-desk",
): BankQuestion {
  return {
    id,
    category: "Music",
    difficulty,
    format,
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

  test("rotates to a different segment format when the candidate pool permits it", () => {
    const questions = [
      candidate("asked-award", 2, 0, "award-desk"),
      candidate("next-award", 2, 1, "award-desk"),
      candidate("next-world", 2, 2, "world-signal"),
    ];

    expect(
      pickQuestion(run({ askedQuestionKeys: ["asked-award"] }), questions, true)?.id,
    ).toBe("next-world");
    expect(
      pickQuestion(run({ askedQuestionKeys: ["asked-award"] }), questions, false)?.id,
    ).toBe("next-world");
  });

  test("prefers the least-used available segment before balancing answer positions", () => {
    const questions = [
      candidate("world-one", 2, 0, "world-signal"),
      candidate("world-two", 2, 1, "world-signal"),
      candidate("world-three", 2, 2, "world-signal"),
      candidate("timeline-one", 2, 1, "night-timeline"),
      candidate("timeline-two", 2, 2, "night-timeline"),
      candidate("timeline-three", 2, 3, "night-timeline"),
      candidate("award-one", 2, 2, "award-desk"),
      candidate("award-two", 2, 3, "award-desk"),
    ];
    const selected = pickQuestion(
      run({
        askedQuestionKeys: [
          "world-one",
          "timeline-one",
          "world-two",
          "timeline-two",
          "award-one",
        ],
      }),
      questions,
      true,
    );

    expect(selected?.id).toBe("award-two");
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
