import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const siteVisitsCounter = "site_visits";

type CounterPeriod = "lifetime" | "daily";

function counterName(environmentKey: string, period: CounterPeriod, dateKey?: string) {
  if (period === "daily") {
    return `${siteVisitsCounter}:${environmentKey}:daily:${dateKey}`;
  }

  return `${siteVisitsCounter}:${environmentKey}:lifetime`;
}

async function getCounter(ctx: QueryCtx | MutationCtx, name: string) {
  return ctx.db
    .query("siteCounters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

async function incrementCounter(
  ctx: MutationCtx,
  {
    environmentKey,
    period,
    dateKey,
    seedCount = 0,
  }: {
    environmentKey: string;
    period: CounterPeriod;
    dateKey?: string;
    seedCount?: number;
  },
) {
  const name = counterName(environmentKey, period, dateKey);
  const counter = await getCounter(ctx, name);
  const now = Date.now();

  if (!counter) {
    const count = seedCount + 1;

    await ctx.db.insert("siteCounters", {
      name,
      count,
      environmentKey,
      period,
      dateKey,
      updatedAt: now,
    });

    return count;
  }

  const count = counter.count + 1;
  await ctx.db.patch(counter._id, { count, updatedAt: now });

  return count;
}

export const getVisitCount = query({
  args: {
    environmentKey: v.optional(v.string()),
    todayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.environmentKey || !args.todayKey) {
      const legacyCounter = await getCounter(ctx, siteVisitsCounter);
      return legacyCounter?.count ?? 0;
    }

    const lifetimeCounter = await getCounter(ctx, counterName(args.environmentKey, "lifetime"));
    const dailyCounter = await getCounter(ctx, counterName(args.environmentKey, "daily", args.todayKey));
    const legacyCounter = args.environmentKey === "production" ? await getCounter(ctx, siteVisitsCounter) : null;

    return {
      lifetime: lifetimeCounter?.count ?? legacyCounter?.count ?? 0,
      today: dailyCounter?.count ?? 0,
    };
  },
});

export const incrementVisitCount = mutation({
  args: {
    environmentKey: v.optional(v.string()),
    todayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.environmentKey || !args.todayKey) {
      const counter = await getCounter(ctx, siteVisitsCounter);

      if (!counter) {
        await ctx.db.insert("siteCounters", {
          name: siteVisitsCounter,
          count: 1,
        });

        return 1;
      }

      const count = counter.count + 1;
      await ctx.db.patch(counter._id, { count });

      return count;
    }

    const legacyCounter = args.environmentKey === "production" ? await getCounter(ctx, siteVisitsCounter) : null;
    const lifetime = await incrementCounter(ctx, {
      environmentKey: args.environmentKey,
      period: "lifetime",
      seedCount: legacyCounter?.count,
    });
    const today = await incrementCounter(ctx, {
      environmentKey: args.environmentKey,
      period: "daily",
      dateKey: args.todayKey,
    });

    return { lifetime, today };
  },
});
