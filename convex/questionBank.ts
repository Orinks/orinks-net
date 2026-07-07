// The question bank lives in data/trivia/questions/*.json and is bundled into
// the server functions here. Answers never reach the client: everything the
// browser sees goes through sanitizeQuestion(). To add a new bank file,
// import it below and add it to the banks array.
import generalTrivia from "../data/trivia/questions/general-trivia.json";
import musicbrainzGenerated from "../data/trivia/questions/musicbrainz-generated.json";
import opentdbMusic from "../data/trivia/questions/opentdb-music.json";

export interface BankQuestion {
  id: string;
  category: string;
  difficulty: number;
  prompt: string;
  choices: string[];
  answer: number;
  explanation?: string;
}

export interface PublicQuestion {
  key: string;
  category: string;
  difficulty: number;
  prompt: string;
  choices: string[];
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
    prompt: question.prompt,
    choices: question.choices,
  };
}
