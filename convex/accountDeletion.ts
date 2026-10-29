// Deleting an orinks.net account used to leave everything it owned behind.
// The Clerk user disappeared and its Freight Fate driver stayed listed on the
// board, kept accepting the game's posts from a device token nobody could
// revoke any more, and went on holding its display name against every other
// account (freightFate.displayNameTaken) -- so a player who deleted an
// account could not even reuse their own name on the next one, which is how
// this surfaced.
//
// Clerk's user.deleted webhook now lands on /clerk/webhook (routed in
// http.ts) and runs the purge below. Verification lives here rather than in a
// Next route because the purge is an internal mutation, which only a Convex
// HTTP action can reach; svix's signature scheme is a dozen lines of
// WebCrypto, so nothing new is installed for it.
import { httpAction, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sameText } from "./freightFateReview";
import { getPlayerBySubject } from "./triviaRuntime";
import { purgeGamesPlayer } from "./games";

/**
 * Every row keyed by this driverId, the driver row included. Two tables are
 * deliberately left out: activation rows, which hold no history, have no
 * driver index and expire on their own within ten minutes; and the leftover
 * freightFateMastodonLinks, which freightFateMastodonPurge is emptying for
 * good and which the schema drops once it is.
 */
export async function purgeDriver(ctx: MutationCtx, driverId: string) {
  const owned = await Promise.all([
    ctx.db.query("freightFateDeviceTokens").withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFatePresence").withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFatePresenceBeats").withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateSaves").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateSaveContent").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateRejectedUploads").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateIntegrityObservations").withIndex("by_driver_slot", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateDriverEvents").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateAchievements").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateMeaningfulPlayOperations").withIndex("by_driver_operation", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateProfileSnapshots").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateStationSuggestions").withIndex("by_driver_created", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFateDrivers").withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).collect(),
  ]);

  const doomed: Id<TableNames>[] = [];
  for (const rows of owned) {
    for (const row of rows) {
      doomed.push(row._id);
    }
  }
  for (const id of doomed) {
    await ctx.db.delete(id);
  }
  return doomed.length;
}

/** The trivia player this account claimed, with its runs and achievements. */
async function purgeTriviaPlayer(ctx: MutationCtx, authSubject: string) {
  const player = await getPlayerBySubject(ctx, authSubject);
  if (!player) {
    return 0;
  }

  const owned = await Promise.all([
    ctx.db.query("triviaRuns").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).collect(),
    ctx.db.query("triviaAchievements").withIndex("by_player_achievement", (q) => q.eq("playerId", player._id)).collect(),
  ]);

  let deleted = 0;
  for (const rows of owned) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  await ctx.db.delete(player._id);
  return deleted + 1;
}

/** Everything the site stores for one Clerk account, in every game. */
export async function purgeAccount(ctx: MutationCtx, authSubject: string) {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .unique();

  return {
    driverId: driver?.driverId ?? null,
    freightFateRows: driver ? await purgeDriver(ctx, driver.driverId) : 0,
    triviaRows: await purgeTriviaPlayer(ctx, authSubject),
    gamesRows: await purgeGamesPlayer(ctx, authSubject),
  };
}

// Run by the webhook below. Also the backfill for accounts deleted before
// this shipped, whose driver rows still carry the dead Clerk subject:
//
//   npx convex run accountDeletion:purgeDeletedAccount <json> --prod
//
// where <json> is {"authSubject":"user_..."}.
export const purgeDeletedAccount = internalMutation({
  args: { authSubject: v.string() },
  handler: (ctx, args) => purgeAccount(ctx, args.authSubject),
});

// --- Clerk webhook ---

/** Svix rejects anything signed more than five minutes ago. So does this. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

function webhookSecret() {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return null;
  }
  // Clerk shows the secret prefixed; the signing key is the base64 after it.
  return secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function svixSignature(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export const clerkWebhook = httpAction(async (ctx, request) => {
  const secret = webhookSecret();
  if (!secret) {
    return new Response("webhook not configured", { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const offered = request.headers.get("svix-signature");
  const body = await request.text();
  if (!id || !timestamp || !offered) {
    return new Response("unsigned", { status: 400 });
  }

  // Both halves matter: the timestamp is part of the signed message, so
  // pinning it is what stops a captured deletion from being replayed later.
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > WEBHOOK_TOLERANCE_MS) {
    return new Response("stale", { status: 400 });
  }

  const expected = await svixSignature(secret, `${id}.${timestamp}.${body}`);
  const accepted = offered
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => sameText(part.slice(3), expected));
  if (!accepted) {
    return new Response("bad signature", { status: 400 });
  }

  // Svix retries every non-2xx, so an event this site has no use for still
  // has to be acknowledged -- and so does unreadable JSON, which no retry
  // will fix.
  let event: { type?: unknown; data?: { id?: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("unreadable", { status: 400 });
  }

  if (event.type === "user.deleted" && typeof event.data?.id === "string") {
    await ctx.runMutation(internal.accountDeletion.purgeDeletedAccount, {
      authSubject: event.data.id,
    });
  }

  return new Response("ok");
});
