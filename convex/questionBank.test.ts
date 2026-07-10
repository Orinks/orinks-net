import { describe, expect, test } from "vitest";
import { questionBank, sanitizeQuestion, type BankQuestion } from "./questionBank";

function strictQuestion(overrides: Partial<BankQuestion> = {}): BankQuestion {
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
        textClue: "A verified deep-house release from July 2026.",
      },
    });
    const serialized = JSON.stringify(publicQuestion);
    expect(serialized).not.toContain("private-provider-id");
    expect(serialized).not.toContain("Private creator");
    expect(serialized).not.toContain(question.source.url);
    expect(serialized).not.toContain('"answer"');
  });

  test("selects only validated official-source records at runtime", () => {
    expect(questionBank).toHaveLength(310);
    expect(new Set(questionBank.map((question) => question.id)).size).toBe(310);
    expect(
      questionBank.some((question) => /^(?:gt-|mb-|otdb-)/u.test(question.id)),
    ).toBe(false);
    expect(
      questionBank.every(
        (question) =>
          question.format.length > 0 &&
          question.explanation.length > 0 &&
          question.source.url.startsWith("https://"),
      ),
    ).toBe(true);
  });
});
