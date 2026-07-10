import { describe, expect, test } from "vitest";
import {
  assertSafeGenerationBudget,
  audioHash,
  buildQuestionNarration,
  validateGenerationBudget,
  verifyAudioManifest,
} from "./trivia-audio-core.mjs";

const voice = {
  voiceId: "voice-1",
  settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3 },
};

describe("trivia audio planning", () => {
  test("narrates the exact visible prompt and numbered choice order", () => {
    expect(
      buildQuestionNarration({
        prompt: "Which title matches this clue?",
        choices: ["First", "Second", "Third", "Fourth"],
      }),
    ).toBe(
      "Which title matches this clue? Your choices are... 1: First. 2: Second. 3: Third. 4: Fourth.",
    );
  });

  test("changes the content hash for text, voice, model, or settings changes", () => {
    const base = {
      id: "question-1",
      text: "Prompt. Your choices are... 1: A. 2: B. 3: C. 4: D.",
      voice,
    };
    const hash = audioHash(base, "eleven_flash_v2_5");
    const variants = [
      [{ ...base, text: `${base.text} Changed.` }, "eleven_flash_v2_5"],
      [{ ...base, voice: { ...voice, voiceId: "voice-2" } }, "eleven_flash_v2_5"],
      [
        { ...base, voice: { ...voice, settings: { ...voice.settings, stability: 0.5 } } },
        "eleven_flash_v2_5",
      ],
      [base, "eleven_multilingual_v2"],
    ];
    for (const [item, model] of variants) {
      expect(audioHash(item, model)).not.toBe(hash);
    }
  });

  test("forbids an unlimited live run but permits a complete dry-run plan", () => {
    expect(() => validateGenerationBudget({ dryRun: false, budget: 0 })).toThrow(
      /explicit positive --budget/,
    );
    expect(() => validateGenerationBudget({ dryRun: true, budget: 0 })).not.toThrow();
  });

  test("enforces live subscription credits with a reserve and model multiplier", () => {
    expect(
      assertSafeGenerationBudget({
        requestedCharacters: 20_000,
        creditMultiplier: 0.5,
        remainingCredits: 12_000,
        reserveCredits: 1_000,
      }),
    ).toEqual({ requestedCredits: 10_000, usableCredits: 11_000 });
    expect(() =>
      assertSafeGenerationBudget({
        requestedCharacters: 23_000,
        creditMultiplier: 0.5,
        remainingCredits: 12_000,
        reserveCredits: 1_000,
      }),
    ).toThrow(/exceed the safe remaining allowance/);
  });

  test("classifies missing, stale, tiny, unknown, and valid manifest entries", () => {
    const report = verifyAudioManifest({
      expected: [
        { id: "valid", webPath: "/audio/trivia/questions/valid.mp3" },
        { id: "missing", webPath: "/audio/trivia/questions/missing.mp3" },
        { id: "stale", webPath: "/audio/trivia/questions/current.mp3" },
        { id: "tiny", webPath: "/audio/trivia/questions/tiny.mp3" },
      ],
      manifest: {
        valid: "/audio/trivia/questions/valid.mp3",
        stale: "/audio/trivia/questions/old.mp3",
        tiny: "/audio/trivia/questions/tiny.mp3",
        unknown: "/audio/trivia/questions/unknown.mp3",
      },
      fileSize: (webPath) =>
        webPath.endsWith("valid.mp3") ? 4_096 : webPath.endsWith("tiny.mp3") ? 100 : null,
      minimumBytes: 1_024,
    });

    expect(report).toEqual({
      valid: ["valid"],
      missing: ["missing"],
      stale: ["stale"],
      tooSmall: ["tiny"],
      unknown: ["unknown"],
    });
  });
});
