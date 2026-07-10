import type { BankQuestion } from "./questionBank";
import { difficultyRange, runRoll, seededRandom, type SeededRun } from "./triviaDeterminism";

export interface QuestionSelectionRun extends SeededRun {
  round: number;
  askedQuestionKeys: readonly string[];
  roundCategory?: string;
  mutatorKey?: string;
  activeRoundBoost?: { key: string; round: number };
}

function chooseCandidate(
  run: QuestionSelectionRun,
  candidates: readonly BankQuestion[],
  salt: string,
  usePlannedOrder: boolean,
): BankQuestion | null {
  if (candidates.length === 0) return null;
  if (usePlannedOrder) return candidates[0];
  return candidates[Math.floor(runRoll(run, salt) * candidates.length)];
}

export function pickRoundCategory(
  run: QuestionSelectionRun,
  questions: readonly BankQuestion[],
  forRound: number,
  questionsPerRound: number,
): string | undefined {
  const asked = new Set(run.askedQuestionKeys);
  const counts = new Map<string, number>();
  for (const question of questions) {
    if (!asked.has(question.id)) {
      counts.set(question.category, (counts.get(question.category) ?? 0) + 1);
    }
  }
  if (run.mutatorKey === "single-signal") {
    const categories = [...new Set(questions.map((question) => question.category))].sort();
    const theme = categories[Math.floor(seededRandom(`${run.seed}:single-signal`)() * categories.length)];
    if ((counts.get(theme) ?? 0) >= questionsPerRound) return theme;
  }
  const viable = [...counts.entries()]
    .filter(([category, count]) => count >= questionsPerRound && category !== run.roundCategory)
    .map(([category]) => category)
    .sort();
  if (viable.length === 0) return undefined;
  return viable[Math.floor(runRoll(run, `category:${forRound}`) * viable.length)];
}

export function pickQuestion(
  run: QuestionSelectionRun,
  questions: readonly BankQuestion[],
  usePlannedOrder = false,
): BankQuestion | null {
  const asked = new Set(run.askedQuestionKeys);
  let [minimum, maximum] = difficultyRange(run.round);
  if (run.activeRoundBoost?.key === "deep-cuts" && run.activeRoundBoost.round === run.round) {
    minimum = Math.min(minimum + 1, 5);
    maximum = Math.min(maximum + 1, 5);
  }
  if (run.mutatorKey === "heavy-rotation") {
    minimum = Math.min(minimum + 1, 5);
    maximum = Math.min(maximum + 1, 5);
  }
  const unasked = questions.filter((question) => !asked.has(question.id));
  let candidates = unasked.filter(
    (question) =>
      question.category === run.roundCategory &&
      question.difficulty >= minimum &&
      question.difficulty <= maximum,
  );
  if (candidates.length === 0 && run.roundCategory) {
    candidates = unasked.filter((question) => question.category === run.roundCategory);
  }
  if (candidates.length === 0) {
    candidates = unasked.filter(
      (question) => question.difficulty >= minimum && question.difficulty <= maximum,
    );
  }
  if (candidates.length === 0) candidates = unasked;
  return chooseCandidate(run, candidates, String(run.askedQuestionKeys.length), usePlannedOrder);
}

function pickHardQuestion(
  run: QuestionSelectionRun,
  questions: readonly BankQuestion[],
  salt: string,
  usePlannedOrder: boolean,
): BankQuestion | null {
  const asked = new Set(run.askedQuestionKeys);
  for (const minimum of [5, 4, 1]) {
    const candidates = questions.filter(
      (question) => !asked.has(question.id) && question.difficulty >= minimum,
    );
    if (candidates.length > 0) {
      return chooseCandidate(run, candidates, salt, usePlannedOrder);
    }
  }
  return null;
}

export function pickDeadAirQuestion(
  run: QuestionSelectionRun,
  questions: readonly BankQuestion[],
  usePlannedOrder = false,
): BankQuestion | null {
  return pickHardQuestion(
    run,
    questions,
    `dead-air:${run.askedQuestionKeys.length}`,
    usePlannedOrder,
  );
}

export function pickBossQuestion(
  run: QuestionSelectionRun,
  questions: readonly BankQuestion[],
  forRound: number,
  usePlannedOrder = false,
): BankQuestion | null {
  return pickHardQuestion(run, questions, `boss-question:${forRound}`, usePlannedOrder);
}
