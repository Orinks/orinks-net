import type { QueryCtx } from "./_generated/server";
import { boostPublicState, getActiveRunDoc, getPlayer, publicRunState } from "./triviaRuntime";
import { inspectActiveRunContent } from "./triviaRunRecovery";
import { sanitizeQuestion } from "./questionBank";

export async function getActiveRunHandler(
  ctx: QueryCtx,
  args: { playerKey: string },
) {
  const player = await getPlayer(ctx, args.playerKey);
  if (!player) return null;
  const run = await getActiveRunDoc(ctx, player._id);
  if (!run) return null;
  const content = await inspectActiveRunContent(ctx, run);
  if (!content.resumable) return null;
  const betweenQuestions = run.pendingBoostOffer !== undefined || run.bossCall !== undefined;
  return {
    run: publicRunState(run, content.bossQuestion),
    boosts: boostPublicState(run),
    question: betweenQuestions
      ? null
      : content.currentQuestion
        ? sanitizeQuestion(content.currentQuestion)
        : null,
    epilogueActive: player.finaleCompletedAt !== undefined,
  };
}
