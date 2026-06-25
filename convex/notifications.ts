import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const subscriptionArgs = {
  endpoint: v.string(),
  expirationTime: v.optional(v.number()),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
  product: v.string(),
};

export const saveBuildSubscription = mutation({
  args: subscriptionArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("buildNotificationSubscriptions")
      .withIndex("by_endpoint_product", (q) =>
        q.eq("endpoint", args.endpoint).eq("product", args.product),
      )
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        expirationTime: args.expirationTime,
        keys: args.keys,
        updatedAt: now,
      });
      return { saved: true };
    }

    await ctx.db.insert("buildNotificationSubscriptions", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    return { saved: true };
  },
});

export const listBuildSubscriptions = query({
  args: {
    product: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db.query("buildNotificationSubscriptions").collect();

    return args.product
      ? subscriptions.filter((subscription) => subscription.product === args.product)
      : subscriptions;
  },
});

export const removeBuildSubscription = mutation({
  args: {
    endpoint: v.string(),
    product: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("buildNotificationSubscriptions")
      .withIndex("by_endpoint_product", (q) =>
        q.eq("endpoint", args.endpoint).eq("product", args.product),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { removed: Boolean(existing) };
  },
});
