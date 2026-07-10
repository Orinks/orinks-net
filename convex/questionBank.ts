// Only strict, editorially verified official-source banks are selectable at
// runtime. Answers, provenance, pronunciation guidance, and clip rights stay
// server-side; the browser receives the exact safe projection below.
import officialSources from "../data/trivia/official-sources.json";
import audiusNeedleDrops from "../data/trivia/questions/official-audius-needle-drops.json";
import classicalSoundtrack from "../data/trivia/questions/official-classical-soundtrack.json";
import genreAwards from "../data/trivia/questions/official-genre-awards-1.json";
import globalChartsAwards from "../data/trivia/questions/official-global-charts-awards.json";
import institutionalMusic from "../data/trivia/questions/official-institutional-music.json";
import modernAwards from "../data/trivia/questions/official-modern-awards.json";
import rootsDanceGospel from "../data/trivia/questions/official-roots-dance-gospel.json";
import {
  sanitizePrivateQuestion,
  validateQuestionCorpus,
  type OfficialSourcePolicy,
  type PrivateQuestion,
  type PublicQuestion,
  type QuestionBankInput,
} from "./questionTypes";

export type BankQuestion = PrivateQuestion;
export type { PublicQuestion };

const activeBanks: QuestionBankInput[] = [
  { file: "official-audius-needle-drops.json", data: audiusNeedleDrops },
  { file: "official-classical-soundtrack.json", data: classicalSoundtrack },
  { file: "official-modern-awards.json", data: modernAwards },
  { file: "official-genre-awards-1.json", data: genreAwards },
  { file: "official-global-charts-awards.json", data: globalChartsAwards },
  { file: "official-institutional-music.json", data: institutionalMusic },
  { file: "official-roots-dance-gospel.json", data: rootsDanceGospel },
];

const validated = validateQuestionCorpus(
  activeBanks,
  officialSources as OfficialSourcePolicy,
  { minimumQuestions: 460 },
);

if (validated.errors.length > 0) {
  const details = validated.errors
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("\n");
  throw new Error(`The active Midnight Signal question corpus is invalid:\n${details}`);
}

export const questionBank: BankQuestion[] = validated.questions;

export const questionByKey = new Map<string, BankQuestion>(
  questionBank.map((question) => [question.id, question]),
);

export function sanitizeQuestion(question: BankQuestion): PublicQuestion {
  return sanitizePrivateQuestion(question);
}
