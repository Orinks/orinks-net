// The question bank lives in data/trivia/questions/*.json and is bundled into
// the server functions here. Answers never reach the client: everything the
// browser sees goes through sanitizeQuestion(). To add a new bank file,
// import it below and add it to the banks array.
import generalTrivia from "../data/trivia/questions/general-trivia.json";
import musicbrainzGenerated from "../data/trivia/questions/musicbrainz-generated.json";
import opentdbMusic from "../data/trivia/questions/opentdb-music.json";
import type { MysteryClip, PublicQuestionClip, QuestionFormat } from "./questionTypes";

type BankQuestionClip = Pick<MysteryClip, "id"> & Partial<Omit<MysteryClip, "id">>;

export interface BankQuestion {
  id: string;
  category: string;
  difficulty: number;
  prompt: string;
  choices: string[];
  answer: number;
  explanation?: string;
  // Legacy banks do not carry the strict contract fields yet. The segment
  // planner supplies a documented format fallback until the corpus cutover.
  format?: QuestionFormat;
  clip?: BankQuestionClip;
}

export interface PublicQuestion {
  key: string;
  category: string;
  difficulty: number;
  format: QuestionFormat;
  prompt: string;
  choices: string[];
  clip: PublicQuestionClip | null;
}

interface BankFile {
  minigame: string;
  questions: BankQuestion[];
}

const banks: BankFile[] = [
  generalTrivia as BankFile,
  opentdbMusic as BankFile,
  musicbrainzGenerated as BankFile,
];

export const questionBank: BankQuestion[] = banks.flatMap((bank) => bank.questions);

export const questionByKey = new Map<string, BankQuestion>(
  questionBank.map((question) => [question.id, question]),
);

export function sanitizeQuestion(question: BankQuestion): PublicQuestion {
  return {
    key: question.id,
    category: question.category,
    difficulty: question.difficulty,
    format: question.format ?? "archive-clue",
    prompt: question.prompt,
    choices: question.choices,
    clip:
      question.clip && typeof question.clip.textClue === "string"
        ? { id: question.clip.id, textClue: question.clip.textClue }
        : null,
  };
}
