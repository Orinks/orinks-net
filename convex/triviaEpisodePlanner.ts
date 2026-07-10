import type { BankQuestion } from "./questionBank";
import type { QuestionFormat } from "./questionTypes";
import { seededRandom } from "./triviaDeterminism";

export type AuthoredChoiceOrder = [0, 1, 2, 3];

export interface PlannedQuestionCandidate {
  questionId: string;
  format: QuestionFormat;
  clipId?: string;
  choiceOrder: AuthoredChoiceOrder;
}

export interface DailyEpisodePlan {
  dateKey: string;
  contentVersion: string;
  rulesVersion: string;
  seed: string;
  mutatorKey: string;
  candidates: PlannedQuestionCandidate[];
}

interface PlanDailyEpisodeInput {
  dateKey: string;
  contentVersion: string;
  rulesVersion: string;
  questions: readonly BankQuestion[];
  mutatorKeys: readonly string[];
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function shuffled<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

function orderedCandidates(questions: readonly BankQuestion[], seed: string): BankQuestion[] {
  const canonical = [...questions].sort(compareIds);
  const ids = new Set<string>();
  const buckets: BankQuestion[][] = [[], [], [], []];
  for (const question of canonical) {
    if (ids.has(question.id)) throw new Error(`Duplicate daily candidate ID: ${question.id}`);
    ids.add(question.id);
    if (question.choices.length !== 4) {
      throw new Error(`Daily candidate ${question.id} must have exactly four authored choices.`);
    }
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) {
      throw new Error(`Daily candidate ${question.id} has an invalid authored answer position.`);
    }
    buckets[question.answer].push(question);
  }

  const answerOrder = shuffled([0, 1, 2, 3], `${seed}:answer-order`);
  const shuffledBuckets = buckets.map((bucket, answer) =>
    shuffled(bucket, `${seed}:answer:${answer}`),
  );
  const ordered: BankQuestion[] = [];
  let remaining = canonical.length;
  while (remaining > 0) {
    for (const answer of answerOrder) {
      const next = shuffledBuckets[answer].shift();
      if (!next) continue;
      ordered.push(next);
      remaining -= 1;
    }
  }
  return ordered;
}

export function planDailyEpisode(input: PlanDailyEpisodeInput): DailyEpisodePlan {
  if (input.questions.length === 0) throw new Error("Cannot plan a daily episode without questions.");
  if (input.mutatorKeys.length === 0) throw new Error("Cannot plan a daily episode without mutators.");

  const seed = `daily:${input.dateKey}:${input.contentVersion}:${input.rulesVersion}`;
  const mutatorKeys = [...input.mutatorKeys].sort();
  const mutatorKey =
    mutatorKeys[Math.floor(seededRandom(`${seed}:mutator`)() * mutatorKeys.length)];
  const candidates = orderedCandidates(input.questions, seed).map((question) => ({
    questionId: question.id,
    format: question.format,
    ...(question.clip ? { clipId: question.clip.id } : {}),
    // Authored order is an invariant. Balance comes from which question is
    // selected, never from shuffling answer text at serve time.
    choiceOrder: [0, 1, 2, 3] as AuthoredChoiceOrder,
  }));

  return {
    dateKey: input.dateKey,
    contentVersion: input.contentVersion,
    rulesVersion: input.rulesVersion,
    seed,
    mutatorKey,
    candidates,
  };
}
