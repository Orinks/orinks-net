import story from "../data/trivia/story.json";
import type { QueryCtx } from "./_generated/server";
import { getPlayer, TAPES } from "./triviaRuntime";

export async function getStoryHandler(
  ctx: QueryCtx,
  args: { playerKey: string },
) {
  const player = await getPlayer(ctx, args.playerKey);
  const unlockedIds = new Set(player?.tapesUnlocked ?? []);
  const epilogueActive = player?.finaleCompletedAt !== undefined;
  return {
    showTitle: story.show.title,
    tapesTotal: TAPES.length,
    tapes: TAPES.filter((tape) => unlockedIds.has(tape.id)).map((tape) => ({
      id: tape.id,
      order: tape.order,
      title: tape.title,
      text: tape.text,
    })),
    finaleLines: epilogueActive ? story.finale.lines : null,
    epilogueLines: epilogueActive ? story.epilogueLines : null,
    epilogueActive,
  };
}
