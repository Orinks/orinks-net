import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { readDriverDirectory, readPresenceBoard } from "./freightFate";

// The game's two public polls -- the drivers board and the driver directory --
// answered here instead of through orinks.net. Through the site, every poll was
// a Vercel request and usually a function run as well, and a game left open
// polls all day; here a poll costs one HTTP action and one cached query.
//
// Both answers come from one snapshot row, rebuilt at most once a minute by
// whichever request first finds it stale. A query's result is cached until a
// document it read changes, so every poll between two rebuilds is served from
// that cache without touching the database: the read cost follows the clock,
// not the number of games polling. The board and the directory are computed
// in the same transaction against the same clock, so the two never name
// different drivers as on duty.
//
// orinks.net's /api/freight-fate/presence and /api/freight-fate/directory stay
// as they are, for builds from before the game read from here.

const SNAPSHOT_KEY = "public";

// Matches FREIGHT_FATE_PRESENCE_SNAPSHOT_SECONDS on the site, so the game sees
// the same age of roster from either door.
export const PUBLIC_SNAPSHOT_MS = 60_000;

// How long the game (or anything else) may reuse an answer. Half the
// snapshot's own minute: a poll can never be handed a roster more than a
// minute and a half old.
const CLIENT_MAX_AGE_S = 30;

export type PublicSnapshot = {
  asOf: number;
  board: Awaited<ReturnType<typeof readPresenceBoard>>;
  directory: Awaited<ReturnType<typeof readDriverDirectory>>;
};

export const readPublicSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<PublicSnapshot | null> => {
    const row = await ctx.db
      .query("freightFatePublicSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SNAPSHOT_KEY))
      .unique();
    return row ? { asOf: row.asOf, board: row.board, directory: row.directory } : null;
  },
});

export const refreshPublicSnapshot = internalMutation({
  args: {},
  handler: async (ctx): Promise<PublicSnapshot> => {
    const now = Date.now();
    const row = await ctx.db
      .query("freightFatePublicSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SNAPSHOT_KEY))
      .unique();
    // Several pollers can find the same stale row at once; the first rebuild
    // to commit wins and the rest hand back what it wrote.
    if (row && now - row.asOf < PUBLIC_SNAPSHOT_MS) {
      return { asOf: row.asOf, board: row.board, directory: row.directory };
    }

    const board = await readPresenceBoard(ctx, { now });
    const directory = await readDriverDirectory(ctx, { now });
    const snapshot = { asOf: now, board, directory };
    if (row) {
      await ctx.db.patch(row._id, snapshot);
    } else {
      await ctx.db.insert("freightFatePublicSnapshots", { key: SNAPSHOT_KEY, ...snapshot });
    }
    return snapshot;
  },
});

export function publicSnapshotIsFresh(snapshot: PublicSnapshot | null, now: number): snapshot is PublicSnapshot {
  return snapshot !== null && now - snapshot.asOf < PUBLIC_SNAPSHOT_MS;
}

function publicJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${CLIENT_MAX_AGE_S}`,
    },
  });
}

async function currentSnapshot(ctx: ActionCtx) {
  const snapshot = await ctx.runQuery(internal.freightFatePublicReads.readPublicSnapshot, {});
  if (publicSnapshotIsFresh(snapshot, Date.now())) {
    return snapshot;
  }
  return ctx.runMutation(internal.freightFatePublicReads.refreshPublicSnapshot, {});
}

/** GET /freight-fate/presence: who is on duty, as orinks.net's presence GET answers. */
export const answerBoardGet = httpAction(async (ctx) => publicJson((await currentSnapshot(ctx)).board));

/** GET /freight-fate/directory: every public driver, as orinks.net's directory GET answers. */
export const answerDirectoryGet = httpAction(async (ctx) => publicJson((await currentSnapshot(ctx)).directory));
