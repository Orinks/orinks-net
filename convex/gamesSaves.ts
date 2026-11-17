import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { checkGame, requireServer } from "./games";

// --- Synced files for Hearken games (lib/hearken-online/saves.js) ---
//
// A copy of a player's save, kept with their account so it follows them to
// another computer. The game seals it before it leaves, so this never reads
// it: a revision is the bytes, their sha256 and the game's layout version.
// Same shape as Freight Fate's cloud saves (freightFateSaves.ts): content in
// its own table so listing revisions stays small, the last ten kept.
//
// `store` is the one write. The base check and the new revision happen in
// one transaction, so two computers uploading at once cannot both win: the
// loser hears `stale` and merges first.

export const KEEP_REVISIONS = 10;
export const MAX_SAVE_BYTES = 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

const slot = { secret: v.string(), game: v.string(), playerId: v.string(), name: v.string() };

function checkSlot(args: { secret: string; game: string; playerId: string; name: string }) {
  requireServer(args.secret);
  checkGame(args.game);
  if (!NAME.test(args.name) || !args.playerId || args.playerId.length > 128) {
    throw new Error("bad save slot");
  }
}

async function revisions(ctx: Pick<MutationCtx, "db">, game: string, playerId: string, name: string) {
  return ctx.db
    .query("gamesSaves")
    .withIndex("by_slot", (q) => q.eq("game", game).eq("playerId", playerId).eq("name", name))
    .order("desc")
    .collect();
}

export const head = query({
  args: slot,
  handler: async (ctx, args) => {
    checkSlot(args);
    const latest = await ctx.db
      .query("gamesSaves")
      .withIndex("by_slot", (q) => q.eq("game", args.game).eq("playerId", args.playerId).eq("name", args.name))
      .order("desc")
      .first();
    if (!latest) return null;
    return { revision: latest.revision, hash: latest.contentHash, bytes: latest.sizeBytes, format: latest.format, at: latest.createdAt };
  },
});

export const read = query({
  args: slot,
  handler: async (ctx, args) => {
    checkSlot(args);
    const latest = await ctx.db
      .query("gamesSaves")
      .withIndex("by_slot", (q) => q.eq("game", args.game).eq("playerId", args.playerId).eq("name", args.name))
      .order("desc")
      .first();
    if (!latest) return null;
    const content = await ctx.db.get(latest.contentId);
    if (!content) return null;
    return {
      revision: latest.revision,
      hash: latest.contentHash,
      bytes: latest.sizeBytes,
      format: latest.format,
      at: latest.createdAt,
      content: content.content,
    };
  },
});

export const store = mutation({
  args: {
    ...slot,
    base: v.number(),
    format: v.number(),
    hash: v.string(),
    content: v.bytes(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    checkSlot(args);
    if (args.content.byteLength === 0 || args.content.byteLength > MAX_SAVE_BYTES || !/^[0-9a-f]{64}$/.test(args.hash)) {
      throw new Error("bad save");
    }
    const kept = await revisions(ctx, args.game, args.playerId, args.name);
    const current = kept[0]?.revision ?? 0;
    if (args.base !== current) return { stale: true, revision: current };
    const contentId = await ctx.db.insert("gamesSaveContent", { playerId: args.playerId, content: args.content });
    const revision = current + 1;
    await ctx.db.insert("gamesSaves", {
      game: args.game,
      playerId: args.playerId,
      name: args.name,
      revision,
      format: args.format,
      contentHash: args.hash,
      sizeBytes: args.content.byteLength,
      contentId,
      createdAt: args.now,
    });
    for (const old of kept.slice(KEEP_REVISIONS - 1)) {
      await ctx.db.delete(old.contentId);
      await ctx.db.delete(old._id);
    }
    return { revision };
  },
});

/** Every save of a player, for deleting their account. */
export async function purgeGamesSaves(ctx: MutationCtx, playerId: string) {
  const rows = await ctx.db.query("gamesSaves").withIndex("by_player", (q) => q.eq("playerId", playerId)).collect();
  const content = await ctx.db.query("gamesSaveContent").withIndex("by_player", (q) => q.eq("playerId", playerId)).collect();
  for (const row of [...rows, ...content]) await ctx.db.delete(row._id);
  return rows.length + content.length;
}
