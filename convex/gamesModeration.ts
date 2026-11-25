import { v } from "convex/values";
import { action } from "./_generated/server";
import { isGamesAdmin } from "./games";

// The owner's chat moderation page (/games/moderation). The cases live in
// each game's GameRooms Durable Object on the site (lib/games/chat-moderation.js);
// these actions check the owner's sign-in, then ask the site for them with
// the server secret, which the object checks (lib/games/moderation-route.js).

function moderationUrl(game: string) {
  const base = (process.env.SITE_URL || "https://orinks.net").replace(/\/$/, "");
  return `${base}/api/games/${encodeURIComponent(game)}/moderation`;
}

async function ask(game: string, init: RequestInit = {}) {
  const secret = process.env.GAMES_SERVER_SECRET;
  if (!secret) return { ok: false as const, code: "unavailable" as const };
  const response = await fetch(moderationUrl(game), {
    ...init,
    headers: { ...(init.headers ?? {}), "x-moderation-key": secret, "content-type": "application/json" },
  });
  if (response.status === 404) return { ok: false as const, code: "no_case" as const };
  if (!response.ok) return { ok: false as const, code: "unavailable" as const };
  return { ok: true as const, data: (await response.json()) as unknown };
}

/** The game's cases and the players whose chat is off; null for anyone but the owner. */
export const adminChatCases = action({
  args: { game: v.string() },
  handler: async (ctx, args) => {
    if (!isGamesAdmin(await ctx.auth.getUserIdentity())) return null;
    return ask(args.game);
  },
});

/** Acts on a case, turns a player's chat back on, or stops a reporter's reports counting. */
export const adminModerate = action({
  args: {
    game: v.string(),
    change: v.union(
      v.object({
        do: v.literal("act"),
        case: v.number(),
        action: v.union(v.literal("dismiss"), v.literal("warn"), v.literal("off-day"), v.literal("off-week"), v.literal("off-good")),
      }),
      v.object({ do: v.literal("lift"), player: v.string() }),
      v.object({ do: v.literal("ignore"), reporter: v.string(), name: v.string(), on: v.boolean() }),
    ),
  },
  handler: async (ctx, args) => {
    if (!isGamesAdmin(await ctx.auth.getUserIdentity())) return { ok: false as const, code: "forbidden" as const };
    return ask(args.game, { method: "POST", body: JSON.stringify(args.change) });
  },
});
