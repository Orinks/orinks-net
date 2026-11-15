// The real boards, from the leaderboard service's records in Convex: the
// same `top()` the game's Leaderboards screen reads through the API.
import { getConvexClient } from "@/lib/convex";
import { convexRecords } from "@/lib/games/records";
import { gamesServerSecret } from "@/lib/games/stores";
import { recordsBoards, TOP } from "@/lib/wickets-online";
import { boardKind, type WicketsBoardSource } from "./index";
import { periodEnd, periodKey } from "./periods";

/** The live boards, or null when this deployment has no backend. */
export function liveBoards(): WicketsBoardSource | null {
  const client = getConvexClient();
  const secret = gamesServerSecret();
  if (!client || !secret) return null;
  const boards = recordsBoards(convexRecords(client, secret, "wickets"));
  return {
    async board(game, period, pace, now) {
      const key = periodKey(period, now);
      const { entries, of } = await boards.top(`${boardKind(game, period, pace)}/${key}`, TOP);
      return { key, endsAt: periodEnd(period, now), entries, of };
    },
  };
}
