import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

export const RATE_LIMIT_WINDOW_MS = 60_000;

// How long a spent counter sticks around before the cleanup cron may drop it.
// Only the current window is ever consulted, so this is pure slack for clock
// skew between the caller's `now` and the server's.
export const RATE_LIMIT_RETENTION_MS = 10 * 60_000;

// Most rows one cleanup pass will delete. Deliberately bounded: a mutation
// that tried to clear an unbounded backlog in one transaction would blow the
// document read limit and fail forever, never draining anything.
const CLEANUP_BATCH = 512;

export async function consumeFreightFateWrite(
  ctx: MutationCtx,
  input: { scope: string; driverId: string; now: number; limit: number },
) {
  const windowStart = input.now - (input.now % RATE_LIMIT_WINDOW_MS);
  const key = `${input.scope}:${input.driverId}:${windowStart}`;
  const row = await ctx.db
    .query("freightFateRateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (row) {
    if (row.count >= input.limit) {
      return false;
    }

    await ctx.db.patch(row._id, {
      count: row.count + 1,
      updatedAt: input.now,
    });
    return true;
  }

  await ctx.db.insert("freightFateRateLimits", {
    key,
    count: 1,
    windowStart,
    updatedAt: input.now,
  });
  return true;
}

// The counter key embeds its own minute-long window, so every driver-minute of
// activity inserts a row that nothing reads again once the minute is over.
// Left alone the table grows forever. Runs on a cron; returns how much it
// removed so a backlog is visible in the logs.
export const cleanupFreightFateRateLimits = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - RATE_LIMIT_RETENTION_MS;
    const expired = await ctx.db
      .query("freightFateRateLimits")
      .withIndex("by_window", (q) => q.lt("windowStart", cutoff))
      .take(CLEANUP_BATCH);

    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    // A full batch means more was waiting than one pass can take; the next
    // tick continues from there.
    return { deleted: expired.length, moreWaiting: expired.length === CLEANUP_BATCH };
  },
});
