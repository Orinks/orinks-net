import type { MutationCtx } from "./_generated/server";

export const RATE_LIMIT_WINDOW_MS = 60_000;

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
