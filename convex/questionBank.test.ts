import { describe, expect, test } from "vitest";
import {
  legacyQuestionBank,
  officialQuestionBank,
  questionBank,
  sanitizeQuestion,
} from "./questionBank";
import type { PrivateQuestion } from "./questionTypes";

function strictQuestion(overrides: Partial<PrivateQuestion> = {}): PrivateQuestion {
  return {
    id: "official-test-0001",
    category: "electronic",
    difficulty: 2,
    format: "award-desk",
    prompt: "Which title matches this official record?",
    choices: ["One", "Two", "Three", "Four"],
    answer: 0,
    explanation: "The official record identifies One.",
    source: {
      publisher: "Audius",
      title: "Official track record",
      url: "https://audius.co/example/official-track",
      accessedAt: "2026-07-10",
      evidenceSummary: "The official record identifies the title.",
    },
    ...overrides,
  };
}

describe("question bank public projection", () => {
  test("projects the segment format and only the safe mystery-clip fields", () => {
    const question = strictQuestion({
      format: "needle-drop",
      clip: {
        id: "ms-clip-7f3a91c2",
        provider: "audius",
        providerAssetId: "private-provider-id",
        startSeconds: 0,
        durationSeconds: 12,
        textClue: "A verified deep-house release from July 2026.",
        attribution: {
          creator: "Private creator",
          copyrightNotice: "Private copyright notice",
          licenseTitle: "Audius Open Music License",
          licenseUrl: "https://audius.org/open-music-license.pdf",
          sourceTitle: "Private title",
          sourceUrl: "https://audius.co/private/track",
        },
      },
    });

    const publicQuestion = sanitizeQuestion(question);
    expect(publicQuestion).toEqual({
      key: question.id,
      category: question.category,
      difficulty: question.difficulty,
      format: "needle-drop",
      prompt: question.prompt,
      choices: question.choices,
      clip: {
        id: "ms-clip-7f3a91c2",
        startSeconds: 0,
        durationSeconds: 12,
        textClue: "A verified deep-house release from July 2026.",
      },
    });
    const serialized = JSON.stringify(publicQuestion);
    expect(serialized).not.toContain("private-provider-id");
    expect(serialized).not.toContain("Private creator");
    expect(serialized).not.toContain(question.source.url);
    expect(serialized).not.toContain('"answer"');
  });

  test("loads strict official banks alongside every pre-existing legacy record", () => {
    expect(officialQuestionBank).toHaveLength(491);
    expect(legacyQuestionBank).toHaveLength(564);
    expect(questionBank).toHaveLength(1055);
    expect(new Set(questionBank.map((question) => question.id)).size).toBe(1055);
    const formatCounts = Object.groupBy(officialQuestionBank, (question) => question.format);
    expect(formatCounts["needle-drop"]).toHaveLength(13);
    expect(formatCounts["sound-lab"]).toHaveLength(9);
    expect(formatCounts["archive-clue"]).toHaveLength(16);
    expect(formatCounts["studio-lab"]).toHaveLength(16);
    expect(formatCounts["odd-one-out"]).toHaveLength(18);
    expect(
      questionBank.some((question) => /^(?:gt-|mb-|otdb-)/u.test(question.id)),
    ).toBe(true);
    expect(
      officialQuestionBank.every(
        (question) =>
          question.format.length > 0 &&
          question.explanation.length > 0 &&
          question.source.url.startsWith("https://"),
      ),
    ).toBe(true);
    expect(legacyQuestionBank.every((question) => question.format === "legacy-trivia")).toBe(true);
  });
});
