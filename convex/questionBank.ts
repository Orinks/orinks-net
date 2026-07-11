// New official banks pass the strict provenance gate. The three pre-existing
// licensed/curated banks remain active through a deliberately separate legacy
// adapter so their original records and source metadata are not rewritten.
import officialSources from "../data/trivia/official-sources.json";
import generalTrivia from "../data/trivia/questions/general-trivia.json";
import musicbrainzGenerated from "../data/trivia/questions/musicbrainz-generated.json";
import opentdbMusic from "../data/trivia/questions/opentdb-music.json";
import audiusNeedleDrops from "../data/trivia/questions/official-audius-needle-drops.json";
import audiusExpanded from "../data/trivia/questions/official-audius-expanded.json";
import classicalSoundtrack from "../data/trivia/questions/official-classical-soundtrack.json";
import genreAwards from "../data/trivia/questions/official-genre-awards-1.json";
import globalChartsAwards from "../data/trivia/questions/official-global-charts-awards.json";
import institutionalMusic from "../data/trivia/questions/official-institutional-music.json";
import modernAwards from "../data/trivia/questions/official-modern-awards.json";
import rootsDanceGospel from "../data/trivia/questions/official-roots-dance-gospel.json";
import formatExpansion from "../data/trivia/questions/official-format-expansion.json";
import {
  createAnswerDisclosure,
  sanitizePrivateQuestion,
  validateQuestionCorpus,
  type AnswerDisclosure,
  type OfficialSourcePolicy,
  type PrivateQuestion,
  type PublicQuestion,
  type QuestionBankInput,
} from "./questionTypes";

export const LEGACY_QUESTION_FORMAT = "legacy-trivia" as const;

export interface LegacyQuestionRecord {
  id: string;
  category: string;
  difficulty: number;
  prompt: string;
  choices: string[];
  answer: number;
  explanation?: string;
  source?: string;
}

export interface LegacyBankQuestion extends LegacyQuestionRecord {
  format: typeof LEGACY_QUESTION_FORMAT;
}

export type BankQuestion = PrivateQuestion | LegacyBankQuestion;
export type { PublicQuestion };

const officialBanks: QuestionBankInput[] = [
  { file: "official-audius-needle-drops.json", data: audiusNeedleDrops },
  { file: "official-audius-expanded.json", data: audiusExpanded },
  { file: "official-classical-soundtrack.json", data: classicalSoundtrack },
  { file: "official-modern-awards.json", data: modernAwards },
  { file: "official-genre-awards-1.json", data: genreAwards },
  { file: "official-global-charts-awards.json", data: globalChartsAwards },
  { file: "official-institutional-music.json", data: institutionalMusic },
  { file: "official-roots-dance-gospel.json", data: rootsDanceGospel },
  { file: "official-format-expansion.json", data: formatExpansion },
];

const validated = validateQuestionCorpus(
  officialBanks,
  officialSources as OfficialSourcePolicy,
  {
    minimumQuestions: 490,
    minimumByFormat: {
      "needle-drop": 8,
      "sound-lab": 8,
      "archive-clue": 12,
      "studio-lab": 12,
      "odd-one-out": 12,
    },
  },
);

if (validated.errors.length > 0) {
  const details = validated.errors
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("\n");
  throw new Error(`The active Midnight Signal question corpus is invalid:\n${details}`);
}

function loadLegacyBank(
  file: string,
  data: { questions: LegacyQuestionRecord[] },
): LegacyBankQuestion[] {
  const ids = new Set<string>();
  return data.questions.map((question, index) => {
    const path = `${file}.questions[${index}]`;
    if (!question.id || ids.has(question.id)) throw new Error(`${path} has a missing or duplicate ID.`);
    if (!question.prompt || question.choices.length !== 4) throw new Error(`${path} is not a four-choice question.`);
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) {
      throw new Error(`${path} has an invalid answer index.`);
    }
    if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5) {
      throw new Error(`${path} has an invalid difficulty.`);
    }
    ids.add(question.id);
    return { ...question, choices: [...question.choices], format: LEGACY_QUESTION_FORMAT };
  });
}

export const officialQuestionBank: PrivateQuestion[] = validated.questions;
export const legacyQuestionBank: LegacyBankQuestion[] = [
  ...loadLegacyBank("general-trivia.json", generalTrivia as { questions: LegacyQuestionRecord[] }),
  ...loadLegacyBank("opentdb-music.json", opentdbMusic as { questions: LegacyQuestionRecord[] }),
  ...loadLegacyBank(
    "musicbrainz-generated.json",
    musicbrainzGenerated as { questions: LegacyQuestionRecord[] },
  ),
];

export const questionBank: BankQuestion[] = [...officialQuestionBank, ...legacyQuestionBank];

export const questionByKey = new Map<string, BankQuestion>(
  questionBank.map((question) => [question.id, question]),
);

export function sanitizeQuestion(question: BankQuestion): PublicQuestion {
  if (question.format !== LEGACY_QUESTION_FORMAT) {
    return sanitizePrivateQuestion(question as PrivateQuestion);
  }
  return {
    key: question.id,
    category: question.category,
    difficulty: question.difficulty as PublicQuestion["difficulty"],
    format: LEGACY_QUESTION_FORMAT,
    prompt: question.prompt,
    choices: [...question.choices] as PublicQuestion["choices"],
    clip: null,
  };
}

export function answerDisclosureForQuestion(question: BankQuestion): AnswerDisclosure | null {
  return question.format === LEGACY_QUESTION_FORMAT
    ? null
    : createAnswerDisclosure(question as PrivateQuestion);
}

export function isOfficialQuestion(question: BankQuestion): question is PrivateQuestion {
  return question.format !== LEGACY_QUESTION_FORMAT;
}

export function isValidLegacyQuestion(value: unknown): value is LegacyBankQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<LegacyBankQuestion>;
  return (
    question.format === LEGACY_QUESTION_FORMAT &&
    typeof question.id === "string" &&
    typeof question.category === "string" &&
    Number.isInteger(question.difficulty) &&
    typeof question.prompt === "string" &&
    Array.isArray(question.choices) &&
    question.choices.length === 4 &&
    Number.isInteger(question.answer) &&
    (question.answer ?? -1) >= 0 &&
    (question.answer ?? 4) <= 3 &&
    (question.source === undefined || typeof question.source === "string")
  );
}
