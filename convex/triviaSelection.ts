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
  allQuestions: readonly BankQuestion[],
  salt: string,
  usePlannedOrder: boolean,
): BankQuestion | null {
  if (candidates.length === 0) return null;
  const byId = new Map(allQuestions.map((question) => [question.id, question]));
  const answerCounts = [0, 0, 0, 0];
  const formatCounts = new Map<BankQuestion["format"], number>();
  let lastFormat: BankQuestion["format"] | undefined;
  for (const questionId of run.askedQuestionKeys) {
    const previous = byId.get(questionId);
    if (!previous) continue;
    answerCounts[previous.answer] += 1;
    formatCounts.set(previous.format, (formatCounts.get(previous.format) ?? 0) + 1);
    lastFormat = previous.format;
  }

  const availableFormats = [...new Set(candidates.map((question) => question.format))];
  const leastUsedFormatCount = Math.min(
    ...availableFormats.map((format) => formatCounts.get(format) ?? 0),
  );
  let preferredFormats = availableFormats.filter(
    (format) => (formatCounts.get(format) ?? 0) === leastUsedFormatCount,
  );
  if (preferredFormats.length > 1 && lastFormat) {
    preferredFormats = preferredFormats.filter((format) => format !== lastFormat);
  }

  const chosenFormat = usePlannedOrder
    ? candidates.find((question) => preferredFormats.includes(question.format))!.format
    : preferredFormats.length === 1
      ? preferredFormats[0]
      : preferredFormats[Math.floor(runRoll(run, `${salt}:format`) * preferredFormats.length)];
  const segmentCandidates = candidates.filter((question) => question.format === chosenFormat);

  if (usePlannedOrder) {
    const availableAnswers = [...new Set(segmentCandidates.map((question) => question.answer))];
    const leastUsed = Math.min(...availableAnswers.map((answer) => answerCounts[answer]));
    // Frozen candidate order breaks ties. Choice text always stays authored.
    return (
      segmentCandidates.find((question) => answerCounts[question.answer] === leastUsed) ??
      segmentCandidates[0]
    );
  }
  const questionSalt = availableFormats.length === 1 ? salt : `${salt}:question`;
  return segmentCandidates[Math.floor(runRoll(run, questionSalt) * segmentCandidates.length)];
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
  return chooseCandidate(
    run,
    candidates,
    questions,
    String(run.askedQuestionKeys.length),
    usePlannedOrder,
  );
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
      return chooseCandidate(run, candidates, questions, salt, usePlannedOrder);
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
