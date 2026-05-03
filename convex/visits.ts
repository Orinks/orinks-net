import { mutation, query } from "./_generated/server";

const siteVisitsCounter = "site_visits";

export const getVisitCount = query({
  args: {},
  handler: async (ctx) => {
    const counter = await ctx.db
      .query("siteCounters")
      .withIndex("by_name", (q) => q.eq("name", siteVisitsCounter))
      .unique();

    return counter?.count ?? 0;
  },
});

export const incrementVisitCount = mutation({
  args: {},
  handler: async (ctx) => {
    const counter = await ctx.db
      .query("siteCounters")
      .withIndex("by_name", (q) => q.eq("name", siteVisitsCounter))
      .unique();

    if (!counter) {
      await ctx.db.insert("siteCounters", {
        name: siteVisitsCounter,
        count: 1,
      });

      return 1;
    }

    const nextCount = counter.count + 1;
    await ctx.db.patch(counter._id, { count: nextCount });

    return nextCount;
  },
});
