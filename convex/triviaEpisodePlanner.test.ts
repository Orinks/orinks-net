import { describe, expect, test } from "vitest";
import type { BankQuestion } from "./questionBank";
import { planDailyEpisode, type PlannedQuestionCandidate } from "./triviaEpisodePlanner";

function question(
  id: string,
  answer: BankQuestion["answer"],
  extra: Partial<BankQuestion> = {},
): BankQuestion {
  return {
    id,
    category: "Music",
    difficulty: 2,
    format: "award-desk",
    prompt: `Question ${id}?`,
    choices: [`${id} A`, `${id} B`, `${id} C`, `${id} D`],
    answer,
    explanation: `Official explanation for ${id}.`,
    source: {
      publisher: "Library of Congress",
      title: `Official source for ${id}`,
      url: `https://www.loc.gov/item/${id}/`,
      accessedAt: "2026-07-10",
      evidenceSummary: `The official record supports ${id}.`,
    },
    ...extra,
  };
}

const versions = {
  dateKey: "2026-07-10",
  contentVersion: "content-test",
  rulesVersion: "rules-test",
  mutatorKeys: ["flat-rates", "thin-ice", "long-haul"],
};

function answerAt(index: number): BankQuestion["answer"] {
  return (index % 4) as BankQuestion["answer"];
}

describe("daily episode planner", () => {
  test("is deterministic and independent of candidate input order", () => {
    const questions = Array.from({ length: 16 }, (_, index) =>
      question(`q-${String(index).padStart(2, "0")}`, answerAt(index)),
    );

    const first = planDailyEpisode({ ...versions, questions });
    const reordered = planDailyEpisode({ ...versions, questions: [...questions].reverse() });

    expect(reordered).toEqual(first);
    expect(first.seed).toContain(versions.dateKey);
    expect(first.contentVersion).toBe(versions.contentVersion);
    expect(first.rulesVersion).toBe(versions.rulesVersion);
  });

  test("balances authored answer positions by selection without shuffling choices", () => {
    const questions = Array.from({ length: 20 }, (_, index) =>
      question(`balanced-${String(index).padStart(2, "0")}`, answerAt(index)),
    );
    const byId = new Map(questions.map((candidate) => [candidate.id, candidate]));
    const plan = planDailyEpisode({ ...versions, questions });
    const counts = [0, 0, 0, 0];

    plan.candidates.forEach((candidate, index) => {
      expect(candidate.choiceOrder).toEqual([0, 1, 2, 3]);
      counts[byId.get(candidate.questionId)!.answer] += 1;
      if ((index + 1) % 4 === 0) {
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    });
    expect(counts).toEqual([5, 5, 5, 5]);
    expect(questions[0].choices).toEqual([
      "balanced-00 A",
      "balanced-00 B",
      "balanced-00 C",
      "balanced-00 D",
    ]);
  });

  test("freezes strict format and opaque clip metadata", () => {
    const standard = question("standard", 0, { format: "world-signal" });
    const media = question("media", 1, {
      format: "sound-lab",
      clip: {
        id: "ms-clip-7f3a91c2",
        provider: "audius",
        providerAssetId: "provider-id",
        startSeconds: 0,
        durationSeconds: 12,
        textClue: "An accessible text clue.",
        attribution: {
          creator: "Artist",
          copyrightNotice: "Copyright Artist",
          licenseTitle: "Audius Open Music License",
          licenseUrl: "https://audius.org/open-music-license.pdf",
          sourceTitle: "Track",
          sourceUrl: "https://audius.co/artist/track",
        },
      },
    });

    const plan = planDailyEpisode({ ...versions, questions: [standard, media] });
    const byId = new Map<string, PlannedQuestionCandidate>(
      plan.candidates.map((candidate) => [candidate.questionId, candidate]),
    );

    expect(byId.get("standard")).toMatchObject({
      format: "world-signal",
      choiceOrder: [0, 1, 2, 3],
    });
    expect(byId.get("standard")).not.toHaveProperty("clipId");
    expect(byId.get("media")).toMatchObject({
      format: "sound-lab",
      clipId: "ms-clip-7f3a91c2",
      choiceOrder: [0, 1, 2, 3],
    });
  });

  test("rejects candidates that cannot preserve the four-choice contract", () => {
    const invalid = {
      ...question("invalid", 0),
      choices: ["A", "B", "C"],
    } as unknown as BankQuestion;
    expect(() => planDailyEpisode({ ...versions, questions: [invalid] })).toThrow(
      /exactly four authored choices/,
    );
  });
});
