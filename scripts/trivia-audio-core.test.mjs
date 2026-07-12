import { describe, expect, test } from "vitest";
import {
  applyPronunciationAliases,
  assertSafeGenerationBudget,
  audioHash,
  buildQuestionAudioPlan,
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

  test("applies authored speech aliases without changing the visible narration", () => {
    const plan = buildQuestionAudioPlan({
      prompt: "Which recording features Tiësto?",
      choices: ["Bzrp", "First", "Second", "Third"],
      pronunciation: {
        Tiësto: "tee-ES-toh",
        Bzrp: "Bizarrap",
      },
    });

    expect(plan.text).toBe(
      "Which recording features tee-ES-toh? Your choices are... 1: Bizarrap. 2: First. 3: Second. 4: Third.",
    );
    expect(plan.displayText).toBe(
      "Which recording features Tiësto? Your choices are... 1: Bzrp. 2: First. 3: Second. 4: Third.",
    );
  });

  test("uses longest literal matches once without rewriting replacement text", () => {
    expect(
      applyPronunciationAliases("A Tribe Called Quest and Tribe", {
        Tribe: "tryb",
        "A Tribe Called Quest": "A Tribe Called Quest",
      }),
    ).toBe("A Tribe Called Quest and tryb");
  });

  test("treats regular-expression metacharacters as literal title text", () => {
    expect(
      applyPronunciationAliases("Was A+B (Live)? the title?", {
        "A+B (Live)?": "A plus B live",
      }),
    ).toBe("Was A plus B live the title?");
  });

  test("rejects invalid or stale pronunciation guidance", () => {
    expect(() => applyPronunciationAliases("Visible text", { Missing: "MIS-ing" })).toThrow(
      /does not appear in the narration/,
    );
    expect(() => applyPronunciationAliases("Visible text", { Visible: "" })).toThrow(
      /non-empty string aliases/,
    );
    expect(() => applyPronunciationAliases("Visible text", { "   ": "space" })).toThrow(
      /non-empty string aliases/,
    );
    expect(() => applyPronunciationAliases("Visible text", null)).toThrow(
      /must be an object/,
    );
  });

  test("changes the content hash for text, voice, model, or settings changes", () => {
    const base = {
      id: "question-1",
      text: "Prompt. Your choices are... 1: A. 2: B. 3: C. 4: D.",
      voice,
    };
    const hash = audioHash(base, "eleven_flash_v2_5");
    expect(hash).toBe("c78a87a52ad9be8d");
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

  test("hashes audible synthesis text without duplicating identity aliases", () => {
    const question = {
      prompt: "Which artist features Tiësto?",
      choices: ["First", "Second", "Third", "Fourth"],
    };
    const firstPlan = buildQuestionAudioPlan({
      ...question,
      pronunciation: { Tiësto: "tee-ES-toh" },
    });
    const secondPlan = buildQuestionAudioPlan({
      ...question,
      pronunciation: { Tiësto: "tee-EHS-toh" },
    });
    expect(audioHash({ ...firstPlan, voice }, "eleven_flash_v2_5")).not.toBe(
      audioHash({ ...secondPlan, voice }, "eleven_flash_v2_5"),
    );

    const identityPlan = buildQuestionAudioPlan({
      ...question,
      pronunciation: { Tiësto: "Tiësto" },
    });
    expect(audioHash({ ...identityPlan, voice }, "eleven_flash_v2_5")).toBe(
      audioHash({ text: identityPlan.text, voice }, "eleven_flash_v2_5"),
    );
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
