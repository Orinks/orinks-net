// What's New announcements for accepted radio stations. Each batch the owner
// accepts on the review page (or a single station from an older per-station
// link) gets one row here, written in the same mutation that accepts it. The
// site renders the rows (lib/whats-new-stations.ts); this file stores only
// the public facts of each station, never who suggested it, their note or the
// stream address.
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { stateName } from "./freightFateStationRules";

function newsStation(row: Doc<"freightFateStationSuggestions">) {
  return {
    id: row._id,
    name: row.name,
    kind: row.kind,
    ...(row.callSign ? { callSign: row.callSign } : {}),
    ...(row.frequency ? { frequency: row.frequency } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.state ? { state: stateName(row.state) } : {}),
    ...(row.genre ? { genre: row.genre } : {}),
  };
}

/** Records one announcement for stations accepted together. */
export async function recordStationNews(
  ctx: MutationCtx,
  rows: Array<Doc<"freightFateStationSuggestions">>,
  now: number,
) {
  if (rows.length === 0) return;
  await ctx.db.insert("freightFateStationNews", { createdAt: now, stations: rows.map(newsStation) });
}

/** Every station announcement, oldest first. */
export const listStationNews = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("freightFateStationNews").withIndex("by_created").collect();
    return rows.map((row) => ({ createdAt: row.createdAt, stations: row.stations }));
  },
});

/**
 * Announces stations accepted before announcements were recorded. A batch
 * shares one acceptance time, so stations are grouped by it. Safe to run
 * again: a station already in an announcement is skipped. Run it once from
 * the Convex dashboard after this deploys.
 */
export const announceEarlierBatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const announced = new Set<string>();
    for (const news of await ctx.db.query("freightFateStationNews").collect()) {
      for (const station of news.stations) announced.add(station.id);
    }
    const accepted = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "accepted"))
      .collect();
    const batches = new Map<number, Array<Doc<"freightFateStationSuggestions">>>();
    for (const row of accepted) {
      if (row.decidedAt === undefined || announced.has(row._id)) continue;
      batches.set(row.decidedAt, [...(batches.get(row.decidedAt) ?? []), row]);
    }
    for (const [decidedAt, rows] of batches) await recordStationNews(ctx, rows, decidedAt);
    return { announcements: batches.size };
  },
});
