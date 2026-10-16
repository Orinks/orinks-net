import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

// Mastodon sharing was removed, but the rows it wrote outlived it: one access
// token per linked driver, and one registered app per instance. This revokes
// each token at its instance (so the grant leaves the player's Mastodon
// security page too) and deletes the rows. The hourly cron finds nothing to
// do once both tables are empty; then this module, the cron and the two
// schema tables can go.

export const PURGE_BATCH = 25;

export const nextLinks = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const links = await ctx.db.query("freightFateMastodonLinks").take(limit);
    return Promise.all(
      links.map(async (link) => {
        const app = await ctx.db
          .query("freightFateMastodonApps")
          .withIndex("by_host", (q) => q.eq("instanceHost", link.instanceHost))
          .first();
        return {
          id: link._id,
          instanceHost: link.instanceHost,
          accessToken: link.accessToken,
          clientId: app?.clientId ?? null,
          clientSecret: app?.clientSecret ?? null,
        };
      }),
    );
  },
});

export const deleteLink = internalMutation({
  args: { id: v.id("freightFateMastodonLinks") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
  },
});

// Apps go only after every link is gone: a link's revoke needs its app.
export const deleteApps = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    if (await ctx.db.query("freightFateMastodonLinks").first()) {
      return 0;
    }
    const apps = await ctx.db.query("freightFateMastodonApps").take(limit);
    for (const app of apps) {
      await ctx.db.delete(app._id);
    }
    return apps.length;
  },
});

export const purgeMastodonLinks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ links: number; apps: number }> => {
    let links = 0;
    for (;;) {
      const batch = await ctx.runQuery(internal.freightFateMastodonPurge.nextLinks, {
        limit: PURGE_BATCH,
      });
      if (batch.length === 0) {
        break;
      }
      for (const link of batch) {
        if (link.clientId && link.clientSecret) {
          try {
            await fetch(`https://${link.instanceHost}/oauth/revoke`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                client_id: link.clientId,
                client_secret: link.clientSecret,
                token: link.accessToken,
              }),
              signal: AbortSignal.timeout(10_000),
            });
          } catch {
            // Best effort; deleting the row is what matters here.
          }
        }
        await ctx.runMutation(internal.freightFateMastodonPurge.deleteLink, { id: link.id });
        links += 1;
      }
    }
    let apps = 0;
    for (;;) {
      const deleted = await ctx.runMutation(internal.freightFateMastodonPurge.deleteApps, {
        limit: PURGE_BATCH,
      });
      apps += deleted;
      if (deleted < PURGE_BATCH) {
        break;
      }
    }
    if (links || apps) {
      console.log(`Purged ${links} Mastodon links and ${apps} Mastodon apps.`);
    }
    return { links, apps };
  },
});
