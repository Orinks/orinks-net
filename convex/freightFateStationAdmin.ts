// Corrections to station suggestions after the owner has decided them.
// Internal-only: run them from the Convex dashboard or the CLI, e.g.
//
//   npx convex run --prod freightFateStationAdmin:findStations '{"text":"sleep radio"}'
//   npx convex run --prod freightFateStationAdmin:makeWebStation '{"id":"<id>"}'
//   npx convex run --prod freightFateStationAdmin:setStreamUrl '{"id":"<id>","streamUrl":"http://..."}'
//
// findStations looks a station up by name or call sign and gives the id the
// other tools take.
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { normalizeStreamUrl } from "./freightFateStationRules";

/** Suggestions whose name or call sign contains the text, any status. */
export const findStations = internalQuery({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const needle = args.text.trim().toLowerCase();
    if (!needle) throw new Error("Give part of a station's name or call sign.");
    const rows = await ctx.db.query("freightFateStationSuggestions").collect();
    return rows
      .filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.callSign ?? "").toLowerCase().includes(needle),
      )
      .map((row) => ({
        id: row._id,
        name: row.name,
        kind: row.kind,
        status: row.status,
        callSign: row.callSign ?? null,
        frequency: row.frequency ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        streamUrl: row.streamUrl,
      }));
  },
});

/**
 * Turns a station suggested as AM or FM into web radio: for a stream that has
 * no licensed transmitter, or not the one it claimed. Drops the call sign,
 * frequency, place and any transmitter found for it, so the game plays it
 * everywhere, and corrects the station's What's New announcement the same
 * way. The stream, name, genre and decision stay as they were.
 */
export const makeWebStation = internalMutation({
  args: { id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error(`No station suggestion with id "${args.id}".`);
    return makeWeb(ctx, row);
  },
});

/** makeWebStation's work, shared with the review page. */
export async function makeWeb(ctx: MutationCtx, row: Doc<"freightFateStationSuggestions">) {
  if (row.kind === "web") return { changed: false, name: row.name, announcements: 0 };

  await ctx.db.patch(row._id, {
    kind: "web",
    callSign: undefined,
    callSignBase: undefined,
    frequency: undefined,
    frequencyMhz: undefined,
    city: undefined,
    state: undefined,
    lat: undefined,
    lon: undefined,
    rangeMiles: undefined,
    placement: undefined,
    placementCheckedAt: undefined,
  });

  let announcements = 0;
  for (const news of await ctx.db.query("freightFateStationNews").collect()) {
    if (!news.stations.some((station) => station.id === row._id)) continue;
    const stations = news.stations.map((station) => {
      if (station.id !== row._id) return station;
      return {
        id: station.id,
        name: station.name,
        kind: "web" as const,
        ...(station.genre ? { genre: station.genre } : {}),
      };
    });
    await ctx.db.patch(news._id, { stations });
    announcements += 1;
  }
  return { changed: true, name: row.name, announcements };
}

/**
 * Points a suggestion at a new stream address, for a station that moved or
 * was suggested with the wrong one. The review page checks the new address
 * when it loads; an accepted station is re-checked overnight.
 */
export const setStreamUrl = internalMutation({
  args: { id: v.id("freightFateStationSuggestions"), streamUrl: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error(`No station suggestion with id "${args.id}".`);
    const result = await changeStreamUrl(ctx, row, args.streamUrl);
    if (!result.ok) throw new Error(result.problem);
    return { name: row.name, status: row.status, from: row.streamUrl, to: result.streamUrl };
  },
});

/** setStreamUrl's work, shared with the review page; says why it refused. */
export async function changeStreamUrl(
  ctx: MutationCtx,
  row: Doc<"freightFateStationSuggestions">,
  address: string,
): Promise<{ ok: true; streamUrl: string } | { ok: false; problem: string }> {
  const streamUrl = address.trim();
  let parsed: URL;
  try {
    parsed = new URL(streamUrl);
  } catch {
    return { ok: false, problem: "That is not a web address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, problem: "A stream address starts with http:// or https://." };
  }
  const streamKey = normalizeStreamUrl(streamUrl);
  const clash = (
    await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_stream_key", (q) => q.eq("streamKey", streamKey))
      .collect()
  ).find((other) => other._id !== row._id);
  if (clash) return { ok: false, problem: `${clash.name} (${clash.status}) already has that stream.` };

  await ctx.db.patch(row._id, {
    streamUrl,
    streamKey,
    // Nobody has heard the new address yet. The nightly re-check of an
    // accepted station clears this and records the format it hears.
    streamUnheard: true,
    failedChecks: 0,
  });
  return { ok: true, streamUrl };
}
