import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { mutatorCatalog } from "./mutators";
import { questionBank, questionByKey, type BankQuestion } from "./questionBank";
import { planDailyEpisode } from "./triviaEpisodePlanner";
import {
  DAILY_EPISODE_CONTENT_VERSION,
  DAILY_EPISODE_RULES_VERSION,
} from "./triviaVersions";

export interface QuestionSelectionPool {
  questions: readonly BankQuestion[];
  usePlannedOrder: boolean;
}

/**
 * Convex mutations are serializable: the indexed read and insert form one
 * transaction, so concurrent first starts retry against the row that won.
 */
export async function getOrCreateDailyEpisode(
  ctx: MutationCtx,
  dateKey: string,
  now: number,
): Promise<Doc<"dailyEpisodes">> {
  const existing = await ctx.db
    .query("dailyEpisodes")
    .withIndex("by_date", (query) => query.eq("dateKey", dateKey))
    .unique();
  if (existing) return existing;

  const plan = planDailyEpisode({
    dateKey,
    contentVersion: DAILY_EPISODE_CONTENT_VERSION,
    rulesVersion: DAILY_EPISODE_RULES_VERSION,
    questions: questionBank,
    mutatorKeys: mutatorCatalog.map((mutator) => mutator.key),
  });
  const episodeId = await ctx.db.insert("dailyEpisodes", { ...plan, createdAt: now });
  const episode = await ctx.db.get(episodeId);
  if (!episode) throw new Error("Daily episode could not be persisted.");
  return episode;
}

export async function selectionPoolForRun(
  ctx: MutationCtx,
  run: Doc<"triviaRuns">,
): Promise<QuestionSelectionPool> {
  // Compatibility path: pre-migration runs have no plan/version fields and
  // continue with the exact live-bank selection logic they started with.
  if (!run.dailyEpisodeId) return { questions: questionBank, usePlannedOrder: false };

  const episode = await ctx.db.get(run.dailyEpisodeId);
  if (!episode) throw new Error("This daily episode plan is missing; refusing to reroll it.");
  const questions = episode.candidates.map((candidate) => {
    if (candidate.choiceOrder.join(",") !== "0,1,2,3") {
      throw new Error(`Daily candidate ${candidate.questionId} has an invalid frozen choice order.`);
    }
    const question = questionByKey.get(candidate.questionId);
    if (!question) {
      throw new Error(`Daily candidate ${candidate.questionId} is missing from this content version.`);
    }
    return question;
  });
  return { questions, usePlannedOrder: true };
}
