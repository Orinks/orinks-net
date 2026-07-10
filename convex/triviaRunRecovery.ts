import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { BankQuestion } from "./questionBank";
import { selectionPoolForRun } from "./triviaDailyEpisodes";

export const RUN_LIBRARY_RESET_REASON =
  "The question library was upgraded, so this unfinished broadcast was retired. A new official-source broadcast is ready.";

export interface ActiveRunContent {
  currentQuestion: BankQuestion | null;
  bossQuestion: BankQuestion | null;
  resumable: boolean;
}

export async function inspectActiveRunContent(
  ctx: MutationCtx | QueryCtx,
  run: Doc<"triviaRuns">,
): Promise<ActiveRunContent> {
  try {
    const selection = await selectionPoolForRun(ctx, run);
    const currentQuestion = run.currentQuestionKey
      ? (selection.questions.find((question) => question.id === run.currentQuestionKey) ?? null)
      : null;
    const bossQuestion =
      run.bossCall?.phase === "question"
        ? (selection.questions.find((question) => question.id === run.bossCall!.questionKey) ?? null)
        : null;
    const resumable =
      run.pendingBoostOffer !== undefined ||
      run.bossCall?.phase === "reward" ||
      (run.bossCall?.phase === "question" && bossQuestion !== null) ||
      (run.currentQuestionKey !== undefined && currentQuestion !== null);
    return { currentQuestion, bossQuestion, resumable };
  } catch {
    return { currentQuestion: null, bossQuestion: null, resumable: false };
  }
}

export async function questionForRun(
  ctx: MutationCtx | QueryCtx,
  run: Doc<"triviaRuns">,
  questionId: string,
): Promise<BankQuestion | null> {
  try {
    const selection = await selectionPoolForRun(ctx, run);
    return selection.questions.find((question) => question.id === questionId) ?? null;
  } catch {
    return null;
  }
}
