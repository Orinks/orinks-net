import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  acceptDriverToken,
  driverTokenAccepted,
  stampClientVersion,
  stampDeviceTokenUse,
} from "./freightFate";
import { consumeFreightFateWrite } from "./freightFateRateLimit";

// --- Mastodon sharing ---
//
// The player links their own Mastodon account (any instance) from the
// Clerk-authenticated page at /freight-fate/online/mastodon. The game then
// offers "notable" deliveries through POST /api/freight-fate/mastodon/share,
// authenticated by the same bearer driver token as every other game call,
// and this module composes the actual post from allowlisted facts. Nothing
// free-form travels from the game to the player's followers.

export const MASTODON_SHARE_WRITE_LIMIT = 6;
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
// read:accounts exists solely for verify_credentials, which names the linked
// account back to the player ("@you@your.server") — a write:statuses-only
// token gets a 403 there and the link lands with no handle, which a blind
// player cannot distinguish from "linked to the wrong account".
export const OAUTH_SCOPES = "read:accounts write:statuses";
// Mastodon's stock per-post limit. Instances can raise it, never assume more.
export const MASTODON_STATUS_LIMIT = 500;
const MAX_ACHIEVEMENT_NAMES = 10;

function mastodonRedirectUri() {
  return (
    process.env.FREIGHT_FATE_MASTODON_REDIRECT_URI ??
    "https://www.orinks.net/api/freight-fate/mastodon/callback"
  );
}

// --- Instance host normalization -------------------------------------------

// Players paste whatever names their server: a bare domain, a URL, a full
// @user@host address. Keep only the host rather than rejecting the forms
// people actually have on hand.
export function normalizeMastodonHost(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let text = value.trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "");
  const slash = text.indexOf("/");
  if (slash !== -1) {
    text = text.slice(0, slash);
  }
  if (text.includes("@")) {
    text = text.split("@").pop() ?? "";
  }
  text = text.replace(/\.+$/, "");
  if (text.length < 4 || text.length > 255) {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(text)) {
    return null;
  }
  return text;
}

// --- Share payload: parse, clamp, compose -----------------------------------

type ShareReason =
  | { type: "level"; level: number }
  | { type: "achievements"; names: string[] }
  | { type: "streak"; count: number };

export type MastodonSharePayload = {
  cargo: string;
  origin: string;
  destination: string;
  distanceMiles: number;
  onTime: boolean;
  reasons: ShareReason[];
};

// The facts come from game data, not player typing, but a tampered client is
// still a client: strip @ and # so a doctored payload cannot smuggle
// mentions or extra hashtags into someone's timeline.
function cleanFact(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value
    .replace(/[@#\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || null;
}

export function parseSharePayload(
  raw: unknown,
): { ok: true; payload: MastodonSharePayload } | { ok: false } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false };
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || typeof value.onTime !== "boolean") {
    return { ok: false };
  }
  const cargo = cleanFact(value.cargo, 60);
  const origin = cleanFact(value.origin, 80);
  const destination = cleanFact(value.destination, 80);
  const distance =
    typeof value.distanceMiles === "number" && Number.isFinite(value.distanceMiles)
      ? Math.round(value.distanceMiles)
      : null;
  if (!cargo || !origin || !destination || distance === null || distance < 1 || distance > 6000) {
    return { ok: false };
  }
  // A routine delivery has no reasons and is never posted; the game
  // enforces the same rule, this end just refuses to trust it.
  if (!Array.isArray(value.reasons) || value.reasons.length === 0 || value.reasons.length > 5) {
    return { ok: false };
  }
  const reasons: ShareReason[] = [];
  for (const entry of value.reasons) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false };
    }
    const reason = entry as Record<string, unknown>;
    if (reason.type === "level") {
      if (
        typeof reason.level !== "number" ||
        !Number.isInteger(reason.level) ||
        reason.level < 1 ||
        reason.level > 99
      ) {
        return { ok: false };
      }
      reasons.push({ type: "level", level: reason.level });
    } else if (reason.type === "achievements") {
      if (
        !Array.isArray(reason.names) ||
        reason.names.length === 0 ||
        reason.names.length > MAX_ACHIEVEMENT_NAMES
      ) {
        return { ok: false };
      }
      const names: string[] = [];
      for (const name of reason.names) {
        const cleanName = cleanFact(name, 80);
        if (!cleanName) {
          return { ok: false };
        }
        names.push(cleanName);
      }
      reasons.push({ type: "achievements", names });
    } else if (reason.type === "streak") {
      if (
        typeof reason.count !== "number" ||
        !Number.isInteger(reason.count) ||
        reason.count < 2 ||
        reason.count > 100_000
      ) {
        return { ok: false };
      }
      reasons.push({ type: "streak", count: reason.count });
    } else {
      return { ok: false };
    }
  }
  return {
    ok: true,
    payload: { cargo, origin, destination, distanceMiles: distance, onTime: value.onTime, reasons },
  };
}

export function composeMastodonStatus(payload: MastodonSharePayload): string {
  const sentences = [
    `Delivered ${payload.cargo} from ${payload.origin} to ${payload.destination} in Freight Fate: ` +
      `${payload.distanceMiles} miles${payload.onTime ? ", on time" : ""}.`,
  ];
  for (const reason of payload.reasons) {
    if (reason.type === "level") {
      sentences.push(`Reached driver level ${reason.level} on arrival.`);
    } else if (reason.type === "achievements") {
      sentences.push(
        reason.names.length === 1
          ? `Earned the ${reason.names[0]} achievement.`
          : `Earned ${reason.names.length} achievements, including ${reason.names[0]}.`,
      );
    } else {
      sentences.push(`That makes ${reason.count} perfect deliveries in a row.`);
    }
  }
  const tag = "#FreightFate";
  let body = sentences.join(" ");
  const room = MASTODON_STATUS_LIMIT - tag.length - 2;
  if (body.length > room) {
    body = `${body.slice(0, room - 1).trimEnd()}…`;
  }
  return `${body}\n\n${tag}`;
}

// --- Owner-facing (Clerk-authenticated) --------------------------------------

// The Clerk-authenticated driver's link, or null. Never returns the token.
export const getMyMastodonLink = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();
    if (!driver) {
      return null;
    }
    const link = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
      .unique();
    if (!link) {
      return null;
    }
    return {
      handle: link.handle,
      instanceHost: link.instanceHost,
      createdAt: link.createdAt,
      lastPostedAt: link.lastPostedAt ?? null,
    };
  },
});

export const driverForCaller = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();
    return driver ? { driverId: driver.driverId } : null;
  },
});

export const appForHost = internalQuery({
  args: { instanceHost: v.string() },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("freightFateMastodonApps")
      .withIndex("by_host", (q) => q.eq("instanceHost", args.instanceHost))
      .unique();
    return app
      ? { clientId: app.clientId, clientSecret: app.clientSecret, scopes: app.scopes ?? "" }
      : null;
  },
});

// First registration wins within a scopes version: a concurrent duplicate
// keeps the stored app so an authorize URL already handed out never points
// at a dead client_id. A row registered under different scopes is replaced —
// its client_id is useless for the scopes we now request.
export const saveApp = internalMutation({
  args: {
    instanceHost: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    scopes: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("freightFateMastodonApps")
      .withIndex("by_host", (q) => q.eq("instanceHost", args.instanceHost))
      .unique();
    if (existing) {
      if ((existing.scopes ?? "") === args.scopes) {
        return { clientId: existing.clientId, clientSecret: existing.clientSecret };
      }
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("freightFateMastodonApps", {
      instanceHost: args.instanceHost,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      scopes: args.scopes,
      createdAt: args.now,
    });
    return { clientId: args.clientId, clientSecret: args.clientSecret };
  },
});

export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    driverId: v.string(),
    instanceHost: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("freightFateMastodonOAuthStates", {
      state: args.state,
      driverId: args.driverId,
      instanceHost: args.instanceHost,
      createdAt: args.now,
    });
    // Piggyback expiry cleanup so abandoned round trips never accumulate.
    const stale = await ctx.db
      .query("freightFateMastodonOAuthStates")
      .withIndex("by_created", (q) => q.lt("createdAt", args.now - OAUTH_STATE_TTL_MS))
      .take(20);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
  },
});

// Single use: the row dies on redemption whether or not it was still fresh.
export const redeemOAuthState = internalMutation({
  args: { state: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("freightFateMastodonOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      return null;
    }
    await ctx.db.delete(row._id);
    if (args.now - row.createdAt > OAUTH_STATE_TTL_MS) {
      return null;
    }
    return { driverId: row.driverId, instanceHost: row.instanceHost };
  },
});

export const saveLink = internalMutation({
  args: {
    driverId: v.string(),
    instanceHost: v.string(),
    accessToken: v.string(),
    handle: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("freightFateMastodonLinks", {
      driverId: args.driverId,
      instanceHost: args.instanceHost,
      accessToken: args.accessToken,
      handle: args.handle,
      createdAt: args.now,
    });
  },
});

export const deleteLink = internalMutation({
  args: { driverId: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (!link) {
      return null;
    }
    await ctx.db.delete(link._id);
    return { instanceHost: link.instanceHost, accessToken: link.accessToken };
  },
});

function mintOAuthState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// Start the OAuth round trip for the signed-in owner: register this
// deployment on the instance if it is new there, mint a single-use state,
// and hand back the authorize URL for the browser to follow.
export const beginLink = action({
  args: { instanceHost: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; authorizeUrl: string }
    | {
        ok: false;
        reason: "invalid_host" | "no_driver" | "instance_unreachable" | "not_a_mastodon_server";
      }
  > => {
    const host = normalizeMastodonHost(args.instanceHost);
    if (!host) {
      return { ok: false, reason: "invalid_host" };
    }
    const driver = await ctx.runQuery(internal.freightFateMastodon.driverForCaller, {});
    if (!driver) {
      return { ok: false, reason: "no_driver" };
    }
    let app = await ctx.runQuery(internal.freightFateMastodon.appForHost, { instanceHost: host });
    if (app && app.scopes !== OAUTH_SCOPES) {
      // Stale registration from an earlier scopes version; authorize would
      // be refused for exceeding it. Register fresh below.
      app = null;
    }
    if (!app) {
      let registered: { client_id?: string; client_secret?: string };
      try {
        const response = await fetch(`https://${host}/api/v1/apps`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: "Freight Fate",
            redirect_uris: mastodonRedirectUri(),
            scopes: OAUTH_SCOPES,
            website: "https://www.orinks.net/freight-fate",
          }),
        });
        if (!response.ok) {
          return { ok: false, reason: "not_a_mastodon_server" };
        }
        registered = (await response.json()) as { client_id?: string; client_secret?: string };
      } catch {
        return { ok: false, reason: "instance_unreachable" };
      }
      if (!registered.client_id || !registered.client_secret) {
        return { ok: false, reason: "not_a_mastodon_server" };
      }
      const saved = await ctx.runMutation(internal.freightFateMastodon.saveApp, {
        instanceHost: host,
        clientId: registered.client_id,
        clientSecret: registered.client_secret,
        scopes: OAUTH_SCOPES,
        now: Date.now(),
      });
      app = { ...saved, scopes: OAUTH_SCOPES };
    }
    const state = mintOAuthState();
    await ctx.runMutation(internal.freightFateMastodon.createOAuthState, {
      state,
      driverId: driver.driverId,
      instanceHost: host,
      now: Date.now(),
    });
    const url = new URL(`https://${host}/oauth/authorize`);
    url.searchParams.set("client_id", app.clientId);
    url.searchParams.set("redirect_uri", mastodonRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES);
    url.searchParams.set("state", state);
    return { ok: true, authorizeUrl: url.toString() };
  },
});

// Finish the round trip. Unauthenticated by design — the callback arrives as
// a bare browser redirect — so the single-use state is the whole secret.
export const completeLink = action({
  args: { state: v.string(), code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true; handle: string } | { ok: false; reason: "state_expired" | "exchange_failed" }
  > => {
    const redeemed = await ctx.runMutation(internal.freightFateMastodon.redeemOAuthState, {
      state: args.state,
      now: Date.now(),
    });
    if (!redeemed) {
      return { ok: false, reason: "state_expired" };
    }
    const app = await ctx.runQuery(internal.freightFateMastodon.appForHost, {
      instanceHost: redeemed.instanceHost,
    });
    if (!app) {
      return { ok: false, reason: "state_expired" };
    }
    let token: { access_token?: string };
    try {
      const response = await fetch(`https://${redeemed.instanceHost}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: args.code,
          client_id: app.clientId,
          client_secret: app.clientSecret,
          redirect_uri: mastodonRedirectUri(),
          scope: OAUTH_SCOPES,
        }),
      });
      if (!response.ok) {
        return { ok: false, reason: "exchange_failed" };
      }
      token = (await response.json()) as { access_token?: string };
    } catch {
      return { ok: false, reason: "exchange_failed" };
    }
    if (!token.access_token) {
      return { ok: false, reason: "exchange_failed" };
    }
    let handle = "";
    try {
      const verify = await fetch(
        `https://${redeemed.instanceHost}/api/v1/accounts/verify_credentials`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      if (verify.ok) {
        const account = (await verify.json()) as { acct?: string; username?: string };
        const acct = account.acct || account.username || "";
        if (acct) {
          handle = acct.includes("@") ? `@${acct}` : `@${acct}@${redeemed.instanceHost}`;
        }
      }
    } catch {
      // The link still works without a handle; it is display sugar.
    }
    await ctx.runMutation(internal.freightFateMastodon.saveLink, {
      driverId: redeemed.driverId,
      instanceHost: redeemed.instanceHost,
      accessToken: token.access_token,
      handle,
      now: Date.now(),
    });
    return { ok: true, handle };
  },
});

// Owner unlink: delete the row, then best-effort revoke at the instance so
// the grant disappears from their Mastodon security page too.
export const unlinkMastodon = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    const driver = await ctx.runQuery(internal.freightFateMastodon.driverForCaller, {});
    if (!driver) {
      return { ok: false };
    }
    const link = await ctx.runMutation(internal.freightFateMastodon.deleteLink, {
      driverId: driver.driverId,
    });
    if (link) {
      const app = await ctx.runQuery(internal.freightFateMastodon.appForHost, {
        instanceHost: link.instanceHost,
      });
      if (app) {
        try {
          await fetch(`https://${link.instanceHost}/oauth/revoke`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_id: app.clientId,
              client_secret: app.clientSecret,
              token: link.accessToken,
            }),
          });
        } catch {
          // Best effort; the deleted row already stops all posting.
        }
      }
    }
    return { ok: true };
  },
});

// --- Game-facing (bearer driver token) ---------------------------------------

export const statusForGame = query({
  args: { driverId: v.string(), driverTokenHash: v.string() },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (!driver) {
      return { ok: false as const, reason: "driver_not_found" as const };
    }
    if (!(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
      return { ok: false as const, reason: "unauthorized" as const };
    }
    const link = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    return { ok: true as const, linked: link !== null, handle: link?.handle ?? "" };
  },
});

// All the database half of a share: rate limit before token check (a wrong
// token guess must stay as cheap as a right one), then the link lookup and
// the duplicate backstop. The action does the network half.
export const authorizeShare = internalMutation({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    eventId: v.string(),
    clientVersion: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (!driver) {
      return { error: "driver_not_found" as const };
    }
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "mastodon-share",
      driverId: args.driverId,
      now: args.now,
      limit: MASTODON_SHARE_WRITE_LIMIT,
    });
    if (!allowed) {
      return { error: "rate_limited" as const };
    }
    const { accepted, device } = await acceptDriverToken(ctx, driver, args.driverTokenHash);
    if (!accepted) {
      return { error: "unauthorized" as const };
    }
    await stampClientVersion(ctx, driver, args.clientVersion, args.now);
    await stampDeviceTokenUse(ctx, device, args.now);
    const link = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (!link) {
      return { error: "no_link" as const };
    }
    if (link.lastEventId === args.eventId) {
      return { error: "duplicate" as const };
    }
    return { instanceHost: link.instanceHost, accessToken: link.accessToken };
  },
});

export const markShared = internalMutation({
  args: { driverId: v.string(), eventId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("freightFateMastodonLinks")
      .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId))
      .unique();
    if (link) {
      await ctx.db.patch(link._id, { lastPostedAt: args.now, lastEventId: args.eventId });
    }
  },
});

export const shareNotableDelivery = action({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    eventId: v.string(),
    occurredAt: v.number(),
    payload: v.any(),
    clientVersion: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; duplicate?: boolean }
    | {
        ok: false;
        reason:
          | "invalid_payload"
          | "driver_not_found"
          | "rate_limited"
          | "unauthorized"
          | "no_link"
          | "mastodon_unreachable"
          | "mastodon_rejected";
      }
  > => {
    const parsed = parseSharePayload(args.payload);
    if (!parsed.ok) {
      return { ok: false, reason: "invalid_payload" };
    }
    // The generated reference widens the union's optional fields; the cast
    // restores the two real shapes authorizeShare returns.
    const auth = (await ctx.runMutation(internal.freightFateMastodon.authorizeShare, {
      driverId: args.driverId,
      driverTokenHash: args.driverTokenHash,
      eventId: args.eventId,
      clientVersion: args.clientVersion,
      now: args.now,
    })) as
      | { error: "driver_not_found" | "rate_limited" | "unauthorized" | "no_link" | "duplicate" }
      | { instanceHost: string; accessToken: string };
    if ("error" in auth) {
      // A retry of an already posted share is a success to the game's
      // outbox: the post exists, the item must clear.
      if (auth.error === "duplicate") {
        return { ok: true, duplicate: true };
      }
      return { ok: false, reason: auth.error };
    }
    const status = composeMastodonStatus(parsed.payload);
    let response: Response;
    try {
      response = await fetch(`https://${auth.instanceHost}/api/v1/statuses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          "content-type": "application/json",
          // Instance-side second layer of the duplicate backstop.
          "idempotency-key": args.eventId,
        },
        body: JSON.stringify({ status, visibility: "public", language: "en" }),
      });
    } catch {
      return { ok: false, reason: "mastodon_unreachable" };
    }
    if (response.status === 401 || response.status === 403) {
      // The player revoked the grant on their instance; the link is dead
      // and retries cannot heal it. Relinking mints a fresh token.
      return { ok: false, reason: "mastodon_rejected" };
    }
    if (!response.ok) {
      return { ok: false, reason: "mastodon_unreachable" };
    }
    await ctx.runMutation(internal.freightFateMastodon.markShared, {
      driverId: args.driverId,
      eventId: args.eventId,
      now: args.now,
    });
    return { ok: true };
  },
});
