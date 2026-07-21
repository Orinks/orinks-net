import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

export const RATE_LIMIT_WINDOW_MS = 60_000;

// How long a driver's idle counter sticks around before the cleanup cron may
// drop it. A swept row costs nothing but a re-insert on the driver's next
// write, so this only needs to outlast a normal play session; a day keeps the
// table at roughly one row per driver who has played recently.
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60_000;

// Most rows one cleanup pass will delete. Deliberately bounded: a mutation
// that tried to clear an unbounded backlog in one transaction would blow the
// document read limit and fail forever, never draining anything.
const CLEANUP_BATCH = 512;

export async function consumeFreightFateWrite(
  ctx: MutationCtx,
  input: { scope: string; driverId: string; now: number; limit: number },
) {
  const windowStart = input.now - (input.now % RATE_LIMIT_WINDOW_MS);
  // One durable counter per scope and driver, rolled over in place when the
  // minute changes. The key used to embed the window too, which meant every
  // driver-minute of play inserted a row nothing would ever read again and
  // left the cleanup cron a permanent backlog to chew through.
  const key = `${input.scope}:${input.driverId}`;
  const row = await ctx.db
    .query("freightFateRateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!row) {
    await ctx.db.insert("freightFateRateLimits", {
      key,
      count: 1,
      windowStart,
      updatedAt: input.now,
    });
    return true;
  }

  // A caller's clock running slow must not hand it a fresh allowance: the
  // window only ever rolls forward, and a late-arriving write counts against
  // the window already on the row.
  if (windowStart > row.windowStart) {
    await ctx.db.patch(row._id, {
      count: 1,
      windowStart,
      updatedAt: input.now,
    });
    return true;
  }

  if (row.count >= input.limit) {
    return false;
  }

  await ctx.db.patch(row._id, {
    count: row.count + 1,
    updatedAt: input.now,
  });
  return true;
}

// Counters belong to drivers, not to minutes, so the table no longer grows
// with playtime — but a driver who stops playing leaves one behind, and the
// old window-keyed rows are still out there. Runs on a cron; returns how much
// it removed so a backlog is visible in the logs.
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
