// Accounts, run claims and stored records for Hearken games' verified runs.
//
// A Hearken game sends a run (seed plus inputs) to /api/games/<game>/; the
// Next route replays it with the game's own rules and hands the computed
// outcome to that game's handler (lib/games/). This module is the storage
// behind that route, game-agnostic: players, the tokens their games hold,
// connect codes, run claims, and a small record store handlers keep their
// results in (best times, boards, ghosts, whatever a game wants).
//
// Everything a verified result depends on is gated by GAMES_SERVER_SECRET,
// set on both the Convex deployment and Vercel: these functions are public
// Convex functions, and without the gate anyone could write a record the
// replay never checked. Only claimActivation (the browser, signed in with
// Clerk) and getMyGamesPlayer are callable without it.
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import { formatUserCode, mintUserCode, normalizeUserCode } from "./freightFateActivation";
import { sameText } from "./freightFateReview";
import { screenDisplayName } from "./moderation";

export const GAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CONNECT_TTL_MS = 10 * 60_000;
// Once a code is entered, only the game holding the device code can collect
// it; a short window from then, as Freight Fate's activation does.
export const CONNECT_COLLECTION_MS = 2 * 60_000;
export const CONNECT_CLAIM_LIMIT = 10;
// Each connect mints a token. Past this many for one game, the oldest is
// dropped: a player reinstalling every week should not pile up tokens.
export const MAX_TOKENS_PER_GAME = 10;
export const MAX_RECORD_BYTES = 16 * 1024;
const SWEEP_BATCH = 200;

function serverSecret() {
  const secret = process.env.GAMES_SERVER_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/** Refuses a caller that is not the site's own server. */
function requireServer(secret: string) {
  const expected = serverSecret();
  if (!expected || !sameText(secret, expected)) {
    throw new ConvexError({ code: "forbidden" as const });
  }
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return toHex(out);
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

function checkGame(game: string) {
  if (!GAME_PATTERN.test(game)) {
    throw new ConvexError({ code: "bad_game" as const });
  }
}

export function normalizePlayerName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

async function playerBySubject(ctx: QueryCtx, authSubject: string) {
  return ctx.db
    .query("gamesPlayers")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .unique();
}

async function nameTaken(ctx: QueryCtx, name: string, exceptSubject: string) {
  const key = name.toLowerCase();
  const rows = await ctx.db
    .query("gamesPlayers")
    .withIndex("by_name_key", (q) => q.eq("nameKey", key))
    .collect();
  return rows.some((row) => row.authSubject !== exceptSubject);
}

// ---- Rate limits -------------------------------------------------------

export const consumeRateLimit = mutation({
  args: { secret: v.string(), key: v.string(), limit: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    return consumeFreightFateWrite(ctx, {
      scope: "games",
      driverId: args.key.slice(0, 160),
      now: args.now,
      limit: Math.max(1, Math.floor(args.limit)),
    });
  },
});

// ---- Players and tokens ------------------------------------------------

/** The player a game's token belongs to, for that game only. */
export const playerForToken = mutation({
  // The route sends the token's hash, never the token (lib/games/stores.ts).
  args: { secret: v.string(), game: v.string(), tokenHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    checkGame(args.game);
    const row = await ctx.db
      .query("gamesTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row || row.game !== args.game) {
      return null;
    }
    const player = await ctx.db
      .query("gamesPlayers")
      .withIndex("by_player_id", (q) => q.eq("playerId", row.playerId))
      .unique();
    if (!player) {
      return null;
    }
    // Coarse, so a busy player does not write on every run.
    if (!row.lastUsedAt || args.now - row.lastUsedAt > 60 * 60_000) {
      await ctx.db.patch(row._id, { lastUsedAt: args.now });
    }
    return { id: player.playerId, name: player.displayName };
  },
});

/** The signed-in account's player, for the connect page. */
export const getMyGamesPlayer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const player = await playerBySubject(ctx, identity.subject);
    return player ? { displayName: player.displayName } : null;
  },
});

// ---- Connecting a game -------------------------------------------------

export const startActivation = mutation({
  args: { secret: v.string(), game: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    checkGame(args.game);
    let userCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = mintUserCode();
      const clash = await ctx.db
        .query("gamesActivations")
        .withIndex("by_user_code", (q) => q.eq("userCode", candidate))
        .unique();
      if (!clash) {
        userCode = candidate;
        break;
      }
    }
    if (!userCode) {
      throw new ConvexError({ code: "unavailable" as const });
    }
    const deviceCode = randomHex(32);
    await ctx.db.insert("gamesActivations", {
      game: args.game,
      deviceCodeHash: await sha256Hex(deviceCode),
      userCode,
      status: "pending",
      createdAt: args.now,
      expiresAt: args.now + CONNECT_TTL_MS,
    });
    return {
      deviceCode,
      userCode: formatUserCode(userCode),
      expiresIn: Math.round(CONNECT_TTL_MS / 1000),
    };
  },
});

/**
 * The game's poll. Mints the token on the one poll that finds the code
 * entered, and deletes the row in the same transaction, so a token is
 * handed out once and never stored except as its hash.
 */
export const pollActivation = mutation({
  // The device code's hash, as with tokens.
  args: { secret: v.string(), game: v.string(), deviceCodeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const row = await ctx.db
      .query("gamesActivations")
      .withIndex("by_device_code", (q) => q.eq("deviceCodeHash", args.deviceCodeHash))
      .unique();
    if (!row || row.game !== args.game || row.expiresAt <= args.now) {
      return { status: "expired" as const };
    }
    if (row.status !== "claimed" || !row.playerId) {
      return { status: "pending" as const };
    }
    const player = await ctx.db
      .query("gamesPlayers")
      .withIndex("by_player_id", (q) => q.eq("playerId", row.playerId!))
      .unique();
    await ctx.db.delete(row._id);
    if (!player) {
      return { status: "expired" as const };
    }
    const tokens = await ctx.db
      .query("gamesTokens")
      .withIndex("by_player_game", (q) => q.eq("playerId", player.playerId).eq("game", args.game))
      .collect();
    tokens.sort((a, b) => a.createdAt - b.createdAt);
    for (const old of tokens.slice(0, Math.max(0, tokens.length - MAX_TOKENS_PER_GAME + 1))) {
      await ctx.db.delete(old._id);
    }
    const token = randomHex(32);
    await ctx.db.insert("gamesTokens", {
      tokenHash: await sha256Hex(token),
      game: args.game,
      playerId: player.playerId,
      createdAt: args.now,
    });
    return { status: "ready" as const, token, name: player.displayName };
  },
});

/**
 * The connect page: a signed-in player entered the code a game spoke.
 * Creates the account's player on first use, from the name given.
 * Validation runs before any write; failures are returned, not thrown, so
 * the rate limiter's count is kept.
 */
export const claimActivation = mutation({
  args: { userCode: v.string(), displayName: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { ok: false as const, code: "not_signed_in" as const };
    }
    const player = await playerBySubject(ctx, identity.subject);
    if (!player && !args.displayName) {
      return { ok: false as const, code: "no_player" as const };
    }
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "games_claim",
      driverId: identity.subject,
      now: args.now,
      limit: CONNECT_CLAIM_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, code: "rate_limited" as const };
    }
    const code = normalizeUserCode(args.userCode);
    const row = code
      ? await ctx.db
          .query("gamesActivations")
          .withIndex("by_user_code", (q) => q.eq("userCode", code))
          .unique()
      : null;
    if (!row || row.status !== "pending" || row.expiresAt <= args.now) {
      return { ok: false as const, code: "unknown_code" as const };
    }
    let playerId = player?.playerId;
    if (!player) {
      const name = normalizePlayerName(args.displayName!);
      const verdict = screenDisplayName(name);
      if (name.length < 3 || !verdict.ok) {
        return {
          ok: false as const,
          code: "name_rejected" as const,
          reason: verdict.ok ? ("needs_letters" as const) : verdict.reason,
        };
      }
      if (await nameTaken(ctx, name, identity.subject)) {
        return { ok: false as const, code: "name_taken" as const };
      }
      playerId = `p_${randomHex(8)}`;
      await ctx.db.insert("gamesPlayers", {
        playerId,
        authSubject: identity.subject,
        displayName: name,
        nameKey: name.toLowerCase(),
        createdAt: args.now,
      });
    }
    // The browser's clock: clamped to the row's own server-stamped window.
    await ctx.db.patch(row._id, {
      status: "claimed",
      playerId,
      expiresAt: Math.min(
        args.now + CONNECT_COLLECTION_MS,
        row.createdAt + CONNECT_TTL_MS + CONNECT_COLLECTION_MS,
      ),
    });
    return { ok: true as const, game: row.game };
  },
});

// ---- Run claims ----------------------------------------------------------

/**
 * Claims a run before any work, so a repeat is answered from what was
 * stored and two copies sent at once cannot both count. A Convex mutation
 * is a serializable transaction, which makes the claim atomic. A claim
 * with no reply after `staleMs` (a request that died partway) may be taken
 * again.
 */
export const claimRun = mutation({
  args: {
    secret: v.string(),
    game: v.string(),
    key: v.string(),
    playerId: v.string(),
    kind: v.string(),
    staleMs: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    checkGame(args.game);
    const existing = await ctx.db
      .query("gamesRuns")
      .withIndex("by_game_key", (q) => q.eq("game", args.game).eq("key", args.key))
      .unique();
    if (existing && (existing.done || args.now - existing.claimedAt < args.staleMs)) {
      return {
        claimed: false as const,
        existing: existing.done
          ? { player: existing.playerId, reply: existing.reply ?? null }
          : { player: existing.playerId },
      };
    }
    const nonce = randomHex(8);
    if (existing) {
      await ctx.db.patch(existing._id, { playerId: args.playerId, claimedAt: args.now, nonce });
    } else {
      await ctx.db.insert("gamesRuns", {
        game: args.game,
        key: args.key,
        playerId: args.playerId,
        kind: args.kind,
        claimedAt: args.now,
        nonce,
        done: false,
      });
    }
    return { claimed: true as const, nonce };
  },
});

async function ownClaim(ctx: MutationCtx, game: string, key: string, nonce: string) {
  const row = await ctx.db
    .query("gamesRuns")
    .withIndex("by_game_key", (q) => q.eq("game", game).eq("key", key))
    .unique();
  return row && row.nonce === nonce && !row.done ? row : null;
}

export const completeRun = mutation({
  args: { secret: v.string(), game: v.string(), key: v.string(), nonce: v.string(), reply: v.any() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const row = await ownClaim(ctx, args.game, args.key, args.nonce);
    if (row) {
      await ctx.db.patch(row._id, { done: true, reply: args.reply ?? null });
    }
  },
});

export const releaseRun = mutation({
  args: { secret: v.string(), game: v.string(), key: v.string(), nonce: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const row = await ownClaim(ctx, args.game, args.key, args.nonce);
    if (row) {
      await ctx.db.delete(row._id);
    }
  },
});

// ---- Records a game's handler keeps ------------------------------------
//
// A record is a JSON value under (game, collection, key), with an optional
// number to order a collection by: a best score, a fastest time, a date.
// What a collection means is the handler's business.

function checkRecord(collection: string, key: string, value: unknown) {
  if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(collection) || key.length === 0 || key.length > 128) {
    throw new ConvexError({ code: "bad_record" as const });
  }
  if (JSON.stringify(value ?? null).length > MAX_RECORD_BYTES) {
    throw new ConvexError({ code: "record_too_large" as const });
  }
}

export const getRecord = query({
  args: { secret: v.string(), game: v.string(), collection: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const row = await ctx.db
      .query("gamesRecords")
      .withIndex("by_key", (q) =>
        q.eq("game", args.game).eq("collection", args.collection).eq("key", args.key),
      )
      .unique();
    return row ? { key: row.key, playerId: row.playerId ?? null, order: row.order ?? null, value: row.value } : null;
  },
});

export const putRecord = mutation({
  args: {
    secret: v.string(),
    game: v.string(),
    collection: v.string(),
    key: v.string(),
    playerId: v.optional(v.string()),
    order: v.optional(v.number()),
    value: v.any(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    checkGame(args.game);
    checkRecord(args.collection, args.key, args.value);
    const row = await ctx.db
      .query("gamesRecords")
      .withIndex("by_key", (q) =>
        q.eq("game", args.game).eq("collection", args.collection).eq("key", args.key),
      )
      .unique();
    const fields = {
      playerId: args.playerId,
      order: args.order,
      value: args.value ?? null,
      updatedAt: args.now,
    };
    if (row) {
      await ctx.db.patch(row._id, fields);
    } else {
      await ctx.db.insert("gamesRecords", {
        game: args.game,
        collection: args.collection,
        key: args.key,
        ...fields,
      });
    }
  },
});

/** A collection's records by their order, highest first unless asked. */
export const listRecords = query({
  args: {
    secret: v.string(),
    game: v.string(),
    collection: v.string(),
    limit: v.number(),
    ascending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const rows = await ctx.db
      .query("gamesRecords")
      .withIndex("by_order", (q) => q.eq("game", args.game).eq("collection", args.collection))
      .order(args.ascending ? "asc" : "desc")
      .take(Math.min(Math.max(1, Math.floor(args.limit)), 100));
    return rows.map((row) => ({
      key: row.key,
      playerId: row.playerId ?? null,
      order: row.order ?? null,
      value: row.value,
    }));
  },
});

/** How many records in a collection order above `order`: a rank, less one. */
export const countAbove = query({
  args: {
    secret: v.string(),
    game: v.string(),
    collection: v.string(),
    order: v.number(),
    ascending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireServer(args.secret);
    const rows = await ctx.db
      .query("gamesRecords")
      .withIndex("by_order", (q) => {
        const scoped = q.eq("game", args.game).eq("collection", args.collection);
        return args.ascending ? scoped.lt("order", args.order) : scoped.gt("order", args.order);
      })
      .take(10_000);
    return rows.length;
  },
});

// ---- Housekeeping --------------------------------------------------------

export const sweepExpiredActivations = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("gamesActivations")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
      .take(SWEEP_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});

/** Everything kept for one account's player, for account deletion. */
export async function purgeGamesPlayer(ctx: MutationCtx, authSubject: string) {
  const player = await playerBySubject(ctx, authSubject);
  if (!player) {
    return 0;
  }
  const owned = await Promise.all([
    ctx.db.query("gamesTokens").withIndex("by_player_game", (q) => q.eq("playerId", player.playerId)).collect(),
    ctx.db.query("gamesRecords").withIndex("by_player", (q) => q.eq("playerId", player.playerId)).collect(),
  ]);
  let deleted = 0;
  for (const rows of owned) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  // Run claims stay, so a copied run still reads as already sent; the
  // player id they keep no longer leads to anyone.
  await ctx.db.delete(player._id);
  return deleted + 1;
}
