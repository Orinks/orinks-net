import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// Mastodon sharing was removed, but the rows it wrote outlived it: one access
// token per linked driver, and one registered app per instance. This deletes
// them in batches and never contacts any Mastodon server. The hourly cron
// finds nothing to do once both tables are empty; then this module, the cron
// and the two schema tables can go.

export const PURGE_BATCH = 100;

export const purgeMastodonRows = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ links: number; apps: number }> => {
    const links = await ctx.db.query("freightFateMastodonLinks").take(PURGE_BATCH);
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    const apps = await ctx.db
      .query("freightFateMastodonApps")
      .take(PURGE_BATCH - links.length);
    for (const app of apps) {
      await ctx.db.delete(app._id);
    }
    if (links.length + apps.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.freightFateMastodonPurge.purgeMastodonRows, {});
    }
    if (links.length || apps.length) {
      console.log(`Deleted ${links.length} Mastodon links and ${apps.length} Mastodon apps.`);
    }
    return { links: links.length, apps: apps.length };
  },
});
