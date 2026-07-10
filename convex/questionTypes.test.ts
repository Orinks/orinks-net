import { describe, expect, test } from "vitest";
import officialSources from "../data/trivia/official-sources.json";
import {
  QUESTION_FORMATS,
  createAnswerDisclosure,
  sanitizePrivateQuestion,
  validateOfficialSourcePolicy,
  validateQuestion,
  validateQuestionCorpus,
  type OfficialSourcePolicy,
  type PrivateQuestion,
  type QuestionFormat,
} from "./questionTypes";

const sourcePolicy: OfficialSourcePolicy = {
  publishers: [
    {
      publisher: "Library of Congress",
      hosts: ["www.loc.gov"],
    },
  ],
};

function validQuestion(overrides: Partial<PrivateQuestion> = {}): PrivateQuestion {
  return {
    id: "official-0001",
    category: "world-music",
    difficulty: 2,
    format: "world-signal",
    prompt: "Which instrument is documented on this Library of Congress collection page?",
    choices: ["Kora", "Sitar", "Bandoneon", "Shakuhachi"],
    answer: 0,
    explanation: "The collection page identifies the pictured instrument as a kora.",
    source: {
      publisher: "Library of Congress",
      title: "Kora in the Performing Arts Collection",
      url: "https://www.loc.gov/item/official-kora-record/",
      accessedAt: "2026-07-10",
      evidenceSummary: "The item record names the instrument as a kora.",
    },
    ...overrides,
  };
}

function errorCodes(question: unknown) {
  return validateQuestion(question, sourcePolicy).errors.map((issue) => issue.code);
}

describe("canonical question validation", () => {
  test("accepts the committed exact-host policy and rejects wildcard hosts", () => {
    expect(validateOfficialSourcePolicy(officialSources).errors).toEqual([]);
    expect(
      validateOfficialSourcePolicy({
        publishers: [{ publisher: "Example Institution", hosts: ["*.example.org"] }],
      }).errors.map((issue) => issue.code),
    ).toContain("official_sources.host.exact");
  });

  test("maps the approved pilot publishers to their exact current hosts", () => {
    const hostsByPublisher = Object.fromEntries(
      officialSources.publishers.map((entry) => [entry.publisher, entry.hosts]),
    );

    expect(hostsByPublisher["The Metropolitan Museum of Art"]).toEqual([
      "metmuseum.org",
      "www.metmuseum.org",
    ]);
    expect(hostsByPublisher["Eurovision Song Contest"]).toEqual(
      expect.arrayContaining(["eurovision.com", "www.eurovision.com"]),
    );
    expect(hostsByPublisher["Recording Industry Association of Japan"]).toEqual([
      "riaj.or.jp",
      "www.riaj.or.jp",
      "adm.riaj.or.jp",
    ]);
    expect(hostsByPublisher["Japan Gold Disc Award"]).toEqual([
      "golddisc.jp",
      "www.golddisc.jp",
    ]);
    expect(hostsByPublisher["Philharmonia Orchestra"]).toEqual([
      "philharmonia.co.uk",
      "www.philharmonia.co.uk",
    ]);
    expect(hostsByPublisher.Audius).toEqual([
      "audius.co",
      "www.audius.co",
      "audius.org",
      "www.audius.org",
      "api.audius.co",
    ]);
  });

  test("accepts every approved format and rejects an unknown format", () => {
    expect(QUESTION_FORMATS).toHaveLength(10);
    for (const format of QUESTION_FORMATS) {
      expect(validateQuestion(validQuestion({ format }), sourcePolicy).errors).toEqual([]);
    }

    expect(errorCodes({ ...validQuestion(), format: "lightning-round" })).toContain(
      "question.format.invalid",
    );
  });

  test("requires the exact four-choice, answer, and difficulty contract", () => {
    expect(errorCodes({ ...validQuestion(), difficulty: 0 })).toContain(
      "question.difficulty.invalid",
    );
    expect(errorCodes({ ...validQuestion(), choices: ["One", "Two", "Three"] })).toContain(
      "question.choices.count",
    );
    expect(
      errorCodes({ ...validQuestion(), choices: ["Kora", " kora ", "Sitar", "Flute"] }),
    ).toContain("question.choices.duplicate");
    expect(errorCodes({ ...validQuestion(), answer: 4 })).toContain("question.answer.invalid");
    expect(
      errorCodes({ ...validQuestion(), choices: ["Kora", "Sitar", "None of the above", "Flute"] }),
    ).toContain("question.choices.catch_all");
  });

  test("requires complete official HTTPS provenance with a real access date", () => {
    expect(errorCodes({ ...validQuestion(), source: "loc" })).toContain("question.source.object");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, url: "http://www.loc.gov/item/official-kora-record/" },
      }),
    ).toContain("question.source.url.https");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, url: "https://loc.gov/item/official-kora-record/" },
      }),
    ).toContain("question.source.url.host");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, url: "https://www.loc.gov/" },
      }),
    ).toContain("question.source.url.generic");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, url: "https://www.loc.gov/search/?q=kora" },
      }),
    ).toContain("question.source.url.search");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, accessedAt: "2026-02-30" },
      }),
    ).toContain("question.source.accessed_at");
    expect(
      errorCodes({
        ...validQuestion(),
        source: { ...validQuestion().source, publisher: "Community Wiki" },
      }),
    ).toContain("question.source.publisher");
  });

  test("accepts canonical Met numeric item routes without allowing search-result bypasses", () => {
    const metQuestion = validQuestion({
      source: {
        ...validQuestion().source,
        publisher: "The Metropolitan Museum of Art",
        title: "Piano",
        url: "https://www.metmuseum.org/art/collection/search/503325",
      },
    });

    expect(
      validateQuestion(metQuestion, officialSources as OfficialSourcePolicy).errors,
    ).toEqual([]);
    for (const url of [
      "https://www.metmuseum.org/art/collection/search/?q=piano",
      "https://www.metmuseum.org/art/collection/%73earch/503325",
    ]) {
      expect(
        validateQuestion(
          { ...metQuestion, source: { ...metQuestion.source, url } },
          officialSources as OfficialSourcePolicy,
        ).errors.map((issue) => issue.code),
      ).toContain("question.source.url.search");
    }
  });

  test("rejects non-NFC visible text", () => {
    expect(errorCodes({ ...validQuestion(), prompt: "Cafe\u0301 music question?" })).toContain(
      "question.text.nfc",
    );
  });

  test("validates complete mystery clips and rejects private metadata on other formats", () => {
    const clip = {
      id: "ms-clip-7f3a91c2",
      provider: "audius" as const,
      providerAssetId: "opaque-track-id",
      startSeconds: 12,
      durationSeconds: 15,
      textClue: "The artist describes this track as a synth-driven night drive.",
      attribution: {
        creator: "Example Artist",
        copyrightNotice: "Copyright Example Artist",
        licenseTitle: "Audius Open Music License",
        licenseUrl: "https://audius.org/open-music-license.pdf",
        sourceTitle: "Example Track on Audius",
        sourceUrl: "https://audius.co/example/track",
      },
    };
    const clipQuestion = validQuestion({ format: "needle-drop", clip });
    expect(validateQuestion(clipQuestion, sourcePolicy).errors).toEqual([]);

    expect(errorCodes({ ...clipQuestion, format: "award-desk" })).toContain(
      "question.clip.format",
    );
    expect(errorCodes({ ...clipQuestion, clip: { ...clip, textClue: "" } })).toContain(
      "question.clip.text_clue",
    );
    expect(errorCodes({ ...clipQuestion, clip: { ...clip, durationSeconds: 0 } })).toContain(
      "question.clip.duration",
    );
    expect(errorCodes({ ...clipQuestion, clip: { ...clip, durationSeconds: 16 } })).toContain(
      "question.clip.duration",
    );
    expect(
      errorCodes({ ...clipQuestion, clip: { ...clip, id: "needle-drop-answer-title" } }),
    ).toContain("question.clip.id.opaque");
    expect(
      errorCodes({
        ...clipQuestion,
        clip: { ...clip, attribution: { ...clip.attribution, licenseUrl: "http://audius.org/license" } },
      }),
    ).toContain("question.clip.attribution.url");
  });

  test("rejects duplicate IDs, normalized prompts, and clip IDs across files", () => {
    const clip = {
      id: "ms-clip-b4e82d16",
      provider: "remote-open" as const,
      providerAssetId: "asset-one",
      startSeconds: 0,
      durationSeconds: 10,
      textClue: "A plucked-string instrument accompanies the singer.",
      attribution: {
        creator: "Archive Ensemble",
        copyrightNotice: "Public domain recording",
        licenseTitle: "Public Domain",
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
        sourceTitle: "Archive Ensemble field recording",
        sourceUrl: "https://www.loc.gov/item/archive-ensemble/",
      },
    };
    const report = validateQuestionCorpus(
      [
        { file: "one.json", data: { questions: [validQuestion({ format: "sound-lab", clip })] } },
        {
          file: "two.json",
          data: {
            questions: [
              validQuestion({
                id: "official-0001",
                format: "sound-lab",
                prompt: `  ${validQuestion().prompt.toUpperCase()}  `,
                clip: { ...clip, providerAssetId: "asset-two" },
              }),
            ],
          },
        },
      ],
      sourcePolicy,
    );

    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "corpus.id.duplicate",
        "corpus.prompt.duplicate",
        "corpus.clip_id.duplicate",
      ]),
    );
  });

  test("keeps hard errors and editorial warnings separate", () => {
    const longPrompt = Array.from({ length: 26 }, (_, index) => `word${index}`).join(" ");
    const report = validateQuestion(validQuestion({ prompt: `${longPrompt}?` }), sourcePolicy);

    expect(report.errors).toEqual([]);
    expect(report.warnings.map((issue) => issue.code)).toContain("question.prompt.long");
  });

  test("requires pronunciation terms to appear in the narrated prompt or choices", () => {
    expect(
      errorCodes(
        validQuestion({
          explanation: "The source credits Eladio Carrión.",
          pronunciation: { "Eladio Carrión": "eh-LAH-dee-oh kah-ree-ON" },
        }),
      ),
    ).toContain("question.pronunciation.unused");
    expect(
      errorCodes(
        validQuestion({
          choices: ["Kora", "Tiësto", "Bandoneon", "Shakuhachi"],
          pronunciation: { Tiësto: "tee-ES-toh" },
        }),
      ),
    ).not.toContain("question.pronunciation.unused");
  });

  test("requests pronunciation review for non-ASCII names, not smart punctuation", () => {
    const smartQuotes = validateQuestion(
      validQuestion({ prompt: "Which title follows “First Song”?" }),
      sourcePolicy,
    );
    expect(smartQuotes.warnings.map((issue) => issue.code)).not.toContain(
      "question.pronunciation.review",
    );

    const accentedName = validateQuestion(
      validQuestion({ choices: ["Kora", "Tiësto", "Bandoneon", "Shakuhachi"] }),
      sourcePolicy,
    );
    expect(accentedName.warnings.map((issue) => issue.code)).toContain(
      "question.pronunciation.review",
    );
    expect(
      validateQuestion(
        validQuestion({
          choices: ["Kora", "Tiësto", "Bandoneon", "Shakuhachi"],
          pronunciation: {},
        }),
        sourcePolicy,
      ).warnings.map((issue) => issue.code),
    ).not.toContain("question.pronunciation.review");
  });
});

describe("private-to-public projections", () => {
  const clipQuestion = validQuestion({
    format: "needle-drop",
    aliases: ["The Kora Song"],
    pronunciation: { Kora: "KOH-rah" },
    clip: {
      id: "ms-clip-29c7fd40",
      provider: "audius",
      providerAssetId: "secret-provider-id",
      startSeconds: 8,
      durationSeconds: 12,
      textClue: "A West African harp-lute is the featured instrument.",
      attribution: {
        creator: "Answer-Bearing Artist",
        copyrightNotice: "Copyright Answer-Bearing Artist",
        licenseTitle: "Audius Open Music License",
        licenseUrl: "https://audius.org/open-music-license.pdf",
        sourceTitle: "Answer-Bearing Track",
        sourceUrl: "https://audius.co/example/answer-bearing-track",
      },
    },
  });

  test("projects an exact pre-answer shape without answer-bearing metadata", () => {
    const publicQuestion = sanitizePrivateQuestion(clipQuestion);

    expect(publicQuestion).toEqual({
      key: "official-0001",
      category: "world-music",
      difficulty: 2,
      format: "needle-drop",
      prompt: clipQuestion.prompt,
      choices: clipQuestion.choices,
      clip: {
        id: "ms-clip-29c7fd40",
        textClue: "A West African harp-lute is the featured instrument.",
      },
    });
    const serialized = JSON.stringify(publicQuestion);
    for (const privateValue of [
      "secret-provider-id",
      "Answer-Bearing Artist",
      "Answer-Bearing Track",
      clipQuestion.source.evidenceSummary,
      clipQuestion.explanation,
      "KOH-rah",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  test("discloses only safe source and licensing details after answering", () => {
    const disclosure = createAnswerDisclosure(clipQuestion);

    expect(disclosure).toEqual({
      source: {
        publisher: clipQuestion.source.publisher,
        title: clipQuestion.source.title,
        url: clipQuestion.source.url,
      },
      clipAttribution: clipQuestion.clip!.attribution,
    });
    const serialized = JSON.stringify(disclosure);
    expect(serialized).not.toContain(clipQuestion.source.evidenceSummary);
    expect(serialized).not.toContain("secret-provider-id");
    expect(serialized).not.toContain('"startSeconds"');
  });

  test("uses null for a question without a mystery clip", () => {
    expect(sanitizePrivateQuestion(validQuestion()).clip).toBeNull();
    expect(createAnswerDisclosure(validQuestion()).clipAttribution).toBeNull();
  });
});

test("the format tuple remains assignable to the public format type", () => {
  const formats: readonly QuestionFormat[] = QUESTION_FORMATS;
  expect(formats).toHaveLength(10);
});
