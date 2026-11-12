// Problem reports staged by a Hearken game for the web form.
//
// A game that reports a problem through the browser sends its logs first,
// with no description, to /api/problem-reports/open. That route keeps them
// here, in file storage, under a code nobody can guess, and hands the game a
// link to /report/<code>. The player writes what happened on that page; its
// send reads the draft back (read), emails it, and then drops it (discard),
// so a send that fails keeps the logs for another try. A draft nobody
// finishes is dropped after a day (expireDrafts).
//
// Writes are gated by GAMES_SERVER_SECRET, as convex/games.ts is: only the
// site's own server stages and takes drafts. peek is public because the code
// is the secret, and it never returns the logs' text.
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sameText } from "./freightFateReview";

/** How long an unfinished draft is kept. */
export const DRAFT_TTL_MS = 24 * 60 * 60_000;
export const MAX_DRAFT_LOGS = 4;
const SWEEP_BATCH = 50;

function requireServer(secret: string) {
  const expected = process.env.GAMES_SERVER_SECRET;
  if (!expected || expected.length < 32 || !sameText(secret, expected)) {
    throw new ConvexError({ code: "forbidden" as const });
  }
}

/** The code in a report link: 160 random bits, so a link cannot be guessed. */
function randomCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const logValidator = v.object({
  name: v.string(),
  storageId: v.id("_storage"),
  bytes: v.number(),
});

async function dropDraft(ctx: MutationCtx, draft: Doc<"problemReportDrafts">) {
  for (const log of draft.logs) {
    await ctx.storage.delete(log.storageId);
  }
  await ctx.db.delete(draft._id);
}

/** Where the server uploads one log before staging the draft that names it. */
export const uploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    return ctx.storage.generateUploadUrl();
  },
});

/** Keeps a game's logs under a new code, and returns the code. */
export const stage = mutation({
  args: {
    secret: v.string(),
    app: v.string(),
    version: v.string(),
    commit: v.optional(v.string()),
    os: v.string(),
    crashed: v.boolean(),
    logs: v.array(logValidator),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    if (args.logs.length > MAX_DRAFT_LOGS) {
      throw new ConvexError({ code: "too_many_logs" as const });
    }
    const code = randomCode();
    await ctx.db.insert("problemReportDrafts", {
      code,
      app: args.app,
      version: args.version,
      ...(args.commit ? { commit: args.commit } : {}),
      os: args.os,
      crashed: args.crashed,
      logs: args.logs,
      createdAt: args.now,
    });
    return code;
  },
});

/** What the report page shows for a code: the game and its logs' names and sizes, never their text. */
export const peek = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query("problemReportDrafts")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!draft || draft.createdAt + DRAFT_TTL_MS < Date.now()) return null;
    return {
      app: draft.app,
      version: draft.version,
      crashed: draft.crashed,
      createdAt: draft.createdAt,
      logs: draft.logs.map((log) => ({ name: log.name, bytes: log.bytes })),
    };
  },
});

export const draftByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<Doc<"problemReportDrafts"> | null> =>
    ctx.db
      .query("problemReportDrafts")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique(),
});

export const removeDraft = internalMutation({
  args: { id: v.id("problemReportDrafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.id);
    if (draft) await dropDraft(ctx, draft);
  },
});

/** The draft for a code, with its logs' text. Null when there is no such draft or it has expired. */
export type TakenDraft = {
  app: string;
  version: string;
  commit?: string;
  os: string;
  crashed: boolean;
  logs: { name: string; text: string }[];
};

export const read = action({
  args: { secret: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<TakenDraft | null> => {
    requireServer(args.secret);
    const draft: Doc<"problemReportDrafts"> | null = await ctx.runQuery(
      internal.problemReports.draftByCode,
      { code: args.code },
    );
    if (!draft || draft.createdAt + DRAFT_TTL_MS < Date.now()) return null;
    const logs: { name: string; text: string }[] = [];
    for (const log of draft.logs) {
      const blob = await ctx.storage.get(log.storageId);
      logs.push({ name: log.name, text: blob ? await blob.text() : "" });
    }
    return {
      app: draft.app,
      version: draft.version,
      ...(draft.commit ? { commit: draft.commit } : {}),
      os: draft.os,
      crashed: draft.crashed,
      logs,
    };
  },
});

/** Drops the draft for a code and its files, once its report was emailed. */
export const discard = mutation({
  args: { secret: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const draft = await ctx.db
      .query("problemReportDrafts")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (draft) await dropDraft(ctx, draft);
    return draft !== null;
  },
});

/** Drops drafts nobody finished within the day, and their files. Batched; runs hourly. */
export const expireDrafts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DRAFT_TTL_MS;
    const old = await ctx.db
      .query("problemReportDrafts")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(SWEEP_BATCH);
    for (const draft of old) {
      await dropDraft(ctx, draft);
    }
    return old.length;
  },
});
