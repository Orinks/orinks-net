import { describe, expect, test } from "vitest";
import { sanitizeQuestion, type BankQuestion } from "./questionBank";

describe("question bank public projection", () => {
  test("projects the segment format and only the safe mystery-clip fields", () => {
    const question: BankQuestion = {
      id: "clip-question-0001",
      category: "electronic",
      difficulty: 2,
      format: "needle-drop",
      prompt: "Which title matches this mystery clip?",
      choices: ["One", "Two", "Three", "Four"],
      answer: 0,
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
    };

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
    expect(JSON.stringify(publicQuestion)).not.toContain("private-provider-id");
    expect(JSON.stringify(publicQuestion)).not.toContain("Private creator");
  });

  test("keeps legacy questions playable with the archive-clue fallback", () => {
    const legacy: BankQuestion = {
      id: "legacy-0001",
      category: "general",
      difficulty: 1,
      prompt: "Legacy prompt?",
      choices: ["One", "Two", "Three", "Four"],
      answer: 1,
    };

    expect(sanitizeQuestion(legacy)).toMatchObject({
      format: "archive-clue",
      clip: null,
    });
  });
});
