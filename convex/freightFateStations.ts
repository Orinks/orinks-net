// Player-suggested radio stations: the gate a suggestion passes before it is
// stored, the owner's review, and the community station list the game
// downloads so new stations reach the dial without a game release.
//
// The order of a suggestion's life: freightFateStationVetting.ts checks the
// form, asks admitSuggestion whether this driver may suggest it at all (signed
// in, under the limits, not a stream already suggested), probes the stream
// and the shipped catalog, then recordSuggestion stores it as pending. The
// daily station digest emails one link to the site's review page, where the
// owner ticks stations and accepts or declines them together
// (reviewStationBatch, decideStationBatch). The pages at the bottom answer the
// per-station links older digests carried, until those expire.
import { action, httpAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { driverTokenAccepted } from "./freightFate";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import {
  escapeHtml,
  hmacHex,
  page,
  reviewSecret,
  sameText,
  type ReviewDecision,
} from "./freightFateReview";
import { PLACEMENT_RETRY_MS } from "./freightFateStationPlacement";
import { recordStationNews } from "./freightFateStationNews";
import { changeStreamUrl, makeWeb } from "./freightFateStationAdmin";
import { turnstileSecret } from "./turnstile";
import {
  ANONYMOUS_DAILY_LIMIT,
  ANONYMOUS_SUGGESTER,
  DAILY_SUGGESTION_LIMIT,
  MAX_LISTED_STATIONS,
  refuse,
  type Refusal,
} from "./freightFateStationRules";

// Suggestion attempts per driver per minute, counted before the stream is
// probed, so a refused probe still costs one. The daily limit counts only
// suggestions that were stored.
export const STATION_SUGGEST_WRITE_LIMIT = 2;
// The same, shared by every visitor who is not signed in.
export const ANONYMOUS_SUGGEST_WRITE_LIMIT = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// Nightly checks an accepted stream may fail in a row before it leaves the
// list. Three nights rides out a station's maintenance window; one that
// answers again comes straight back.
export const STATION_DEAD_AFTER = 3;

export const STATION_LINK_TTL_MS = 14 * DAY_MS;

// -- the gate -------------------------------------------------------------------

/**
 * Drivers the daily allowance does not apply to: the owner, adding stations
 * in bulk. A comma-separated list of driver IDs in this deployment's
 * environment, e.g. npx convex env set FREIGHT_FATE_UNLIMITED_SUGGESTERS <id> --prod
 */
function unlimitedSuggester(driverId: string) {
  return (process.env.FREIGHT_FATE_UNLIMITED_SUGGESTERS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === driverId);
}

async function findDuplicate(
  ctx: QueryCtx,
  streamKey: string,
  callSignBase: string | undefined,
): Promise<Refusal | null> {
  const matches: Doc<"freightFateStationSuggestions">[] = await ctx.db
    .query("freightFateStationSuggestions")
    .withIndex("by_stream_key", (q) => q.eq("streamKey", streamKey))
    .collect();
  if (callSignBase) {
    matches.push(
      ...(await ctx.db
        .query("freightFateStationSuggestions")
        .withIndex("by_call_sign_base", (q) => q.eq("callSignBase", callSignBase))
        .collect()),
    );
  }
  if (matches.length === 0) return null;
  return matches.every((row) => row.status === "declined")
    ? refuse("already_declined")
    : refuse("duplicate_suggestion");
}

async function suggestingDriver(
  ctx: MutationCtx,
  args: { driverId?: string; driverTokenHash?: string; authSubject?: string },
) {
  if (args.authSubject !== undefined) {
    return await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.authSubject))
      .unique();
  }
  if (args.driverId === undefined) return null;
  return await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", args.driverId!))
    .unique();
}

/** Whether this driver may suggest this stream now. Spends one attempt. */
export const admitSuggestion = internalMutation({
  args: {
    driverId: v.optional(v.string()),
    driverTokenHash: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    // Someone not signed in, who has already passed the human check.
    anonymous: v.optional(v.boolean()),
    streamKey: v.string(),
    callSignBase: v.optional(v.string()),
    now: v.number(),
    // False for the second and later stations of one picker send, which the
    // first already paid the attempt for.
    spendAttempt: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: true; driverId: string } | Refusal> => {
    const spend = args.spendAttempt !== false;
    if (args.anonymous) {
      const allowed = !spend || (await consumeFreightFateWrite(ctx, {
        scope: "station-suggest",
        driverId: ANONYMOUS_SUGGESTER,
        now: args.now,
        limit: ANONYMOUS_SUGGEST_WRITE_LIMIT,
      }));
      if (!allowed) return refuse("rate_limited");
      const today = await ctx.db
        .query("freightFateStationSuggestions")
        .withIndex("by_driver_created", (q) =>
          q.eq("driverId", ANONYMOUS_SUGGESTER).gt("createdAt", args.now - DAY_MS))
        .take(ANONYMOUS_DAILY_LIMIT);
      if (today.length >= ANONYMOUS_DAILY_LIMIT) return refuse("anonymous_limit");
      const duplicate = await findDuplicate(ctx, args.streamKey, args.callSignBase);
      if (duplicate) return duplicate;
      return { ok: true, driverId: ANONYMOUS_SUGGESTER };
    }
    const driver = await suggestingDriver(ctx, args);
    if (!driver) return refuse("driver_not_found");
    const allowed = !spend || (await consumeFreightFateWrite(ctx, {
      scope: "station-suggest",
      driverId: driver.driverId,
      now: args.now,
      limit: STATION_SUGGEST_WRITE_LIMIT,
    }));
    if (!allowed) return refuse("rate_limited");
    if (args.authSubject === undefined) {
      if (!args.driverTokenHash || !(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
        return refuse("unauthorized");
      }
    }
    if (!unlimitedSuggester(driver.driverId)) {
      const today = await ctx.db
        .query("freightFateStationSuggestions")
        .withIndex("by_driver_created", (q) =>
          q.eq("driverId", driver.driverId).gt("createdAt", args.now - DAY_MS))
        .take(DAILY_SUGGESTION_LIMIT);
      if (today.length >= DAILY_SUGGESTION_LIMIT) return refuse("daily_limit");
    }
    const duplicate = await findDuplicate(ctx, args.streamKey, args.callSignBase);
    if (duplicate) return duplicate;
    return { ok: true, driverId: driver.driverId };
  },
});

/** How many more suggestions this driver, or everyone not signed in, may send today. */
export const suggestionAllowance = internalQuery({
  args: { authSubject: v.optional(v.string()), anonymous: v.optional(v.boolean()), now: v.number() },
  handler: async (ctx, args): Promise<number> => {
    let driverId = ANONYMOUS_SUGGESTER;
    let limit = ANONYMOUS_DAILY_LIMIT;
    if (!args.anonymous) {
      if (args.authSubject === undefined) return 0;
      const driver = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.authSubject))
        .unique();
      if (!driver) return 0;
      if (unlimitedSuggester(driver.driverId)) return MAX_LISTED_STATIONS;
      driverId = driver.driverId;
      limit = DAILY_SUGGESTION_LIMIT;
    }
    const today = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_driver_created", (q) => q.eq("driverId", driverId).gt("createdAt", args.now - DAY_MS))
      .take(limit);
    return limit - today.length;
  },
});

/** Store a suggestion that passed every check, unless one raced it in. */
export const recordSuggestion = internalMutation({
  args: {
    driverId: v.string(),
    kind: v.union(v.literal("terrestrial"), v.literal("web")),
    name: v.string(),
    streamUrl: v.string(),
    streamKey: v.string(),
    streamFormat: v.string(),
    streamUnheard: v.optional(v.boolean()),
    genre: v.optional(v.string()),
    note: v.optional(v.string()),
    callSign: v.optional(v.string()),
    callSignBase: v.optional(v.string()),
    frequency: v.optional(v.string()),
    frequencyMhz: v.optional(v.number()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    catalogChecked: v.boolean(),
    placement: v.optional(v.literal("not_found")),
    placementCheckedAt: v.optional(v.number()),
    clientVersion: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | Refusal> => {
    const duplicate = await findDuplicate(ctx, args.streamKey, args.callSignBase);
    if (duplicate) return duplicate;
    const { now, ...fields } = args;
    await ctx.db.insert("freightFateStationSuggestions", {
      ...fields,
      status: "pending",
      createdAt: now,
    });
    return { ok: true };
  },
});

// -- the list the game downloads ---------------------------------------------------

export type CommunityStation = Record<string, string | number | boolean>;

/** One accepted suggestion as a row of the game's radio catalog. */
export function communityStationRow(row: Doc<"freightFateStationSuggestions">): CommunityStation {
  const located =
    row.kind === "terrestrial" &&
    row.lat !== undefined &&
    row.lon !== undefined &&
    row.rangeMiles !== undefined &&
    row.rangeMiles > 0;
  const station: CommunityStation = {
    id: `community-${row._id}`,
    name: row.name,
    call_sign: row.callSign ?? "",
    format: row.genre ?? "",
    source: "suggested by a player, reviewed by Freight Fate",
    source_type: located ? "imported" : "web",
    station_type: located ? "imported" : "web",
    stream_url: row.streamUrl,
    stream_format: row.streamFormat,
    real_stream: true,
    safe_for_streaming: false,
    supported: true,
    always_available: !located,
    market: row.city ?? "",
    region: row.state ?? "",
  };
  if (located) {
    station.lat = row.lat!;
    station.lon = row.lon!;
    station.range_miles = row.rangeMiles!;
    if (row.frequencyMhz !== undefined) station.frequency_mhz = row.frequencyMhz;
  }
  return station;
}

/** Every accepted station whose stream still answers, oldest first. */
/**
 * Whether a visitor who is not signed in can suggest: the human check needs
 * its secret in this deployment's environment, so the site form offers the
 * signed-out path only once it is there.
 */
export const anonymousSuggestionsOpen = query({
  args: {},
  handler: async () => Boolean(turnstileSecret(process.env.TURNSTILE_SECRET_KEY)),
});

export const listCommunityStations = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "accepted"))
      .collect();
    return {
      schema: 1,
      stations: rows
        .filter((row) => (row.failedChecks ?? 0) < STATION_DEAD_AFTER)
        .map(communityStationRow),
    };
  },
});

// -- the nightly re-check -------------------------------------------------------------

export const stationsToRecheck = internalQuery({
  args: { limit: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    // Never-checked rows (lastCheckedAt undefined) sort first, then oldest.
    const rows = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_status_checked", (q) => q.eq("status", "accepted"))
      .take(args.limit);
    return rows.map((row) => ({
      id: row._id,
      streamUrl: row.streamUrl,
      needsPlacement: needsPlacement(row, args.now),
    }));
  },
});

/** An accepted AM or FM station with no transmitter yet, not asked about lately. */
export function needsPlacement(row: Doc<"freightFateStationSuggestions">, now: number) {
  if (row.kind !== "terrestrial" || !row.callSign || row.lat !== undefined) return false;
  return row.placement !== "not_found" || now - (row.placementCheckedAt ?? 0) >= PLACEMENT_RETRY_MS;
}

/** What placeStation needs to ask the FCC, or null when there is nothing to ask. */
export const stationForPlacement = internalQuery({
  args: { id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "accepted" || row.kind !== "terrestrial" || !row.callSign) return null;
    if (row.lat !== undefined) return null;
    return { callSign: row.callSign, state: row.state, frequency: row.frequency };
  },
});

export const recordStationPlacement = internalMutation({
  args: {
    id: v.id("freightFateStationSuggestions"),
    placement: v.union(
      v.null(),
      v.object({
        lat: v.number(),
        lon: v.number(),
        rangeMiles: v.number(),
        frequencyMhz: v.optional(v.number()),
        community: v.string(),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    // A row placed by hand meanwhile keeps the owner's numbers.
    if (!row || row.lat !== undefined) return;
    if (!args.placement) {
      await ctx.db.patch(args.id, { placement: "not_found", placementCheckedAt: args.now });
      return;
    }
    const { lat, lon, rangeMiles, frequencyMhz, community } = args.placement;
    await ctx.db.patch(args.id, {
      lat,
      lon,
      rangeMiles,
      frequencyMhz: frequencyMhz ?? row.frequencyMhz,
      city: row.city ?? (community || undefined),
      placement: "fcc",
      placementCheckedAt: args.now,
    });
  },
});

export const recordStationCheck = internalMutation({
  args: {
    id: v.id("freightFateStationSuggestions"),
    ok: v.boolean(),
    format: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (args.ok) {
      await ctx.db.patch(args.id, {
        lastCheckedAt: args.now,
        failedChecks: 0,
        ...(row.streamUnheard ? { streamUnheard: undefined, streamFormat: args.format ?? row.streamFormat } : {}),
      });
      return;
    }
    // A stream the check has never heard was accepted on the reviewer's own
    // listening, so not reaching it from here is no sign it died.
    await ctx.db.patch(args.id, {
      lastCheckedAt: args.now,
      failedChecks: row.streamUnheard ? 0 : (row.failedChecks ?? 0) + 1,
    });
  },
});

// -- the digest -----------------------------------------------------------------------

export type StationDigestRow = {
  id: Id<"freightFateStationSuggestions">;
  createdAt: number;
  displayName: string;
  driverId: string;
  kind: "terrestrial" | "web";
  name: string;
  streamUrl: string;
  streamFormat: string;
  streamUnheard?: boolean;
  genre: string | null;
  note: string | null;
  callSign: string | null;
  frequency: string | null;
  city: string | null;
  state: string | null;
  catalogChecked: boolean;
  callSignUnlicensed: boolean;
  isNew: boolean;
};

async function digestRow(
  ctx: QueryCtx,
  row: Doc<"freightFateStationSuggestions">,
): Promise<StationDigestRow> {
  const driver = await ctx.db
    .query("freightFateDrivers")
    .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId))
    .first();
  return {
    id: row._id,
    createdAt: row.createdAt,
    displayName: driver?.displayName ?? row.driverId,
    driverId: row.driverId,
    kind: row.kind,
    name: row.name,
    streamUrl: row.streamUrl,
    streamFormat: row.streamFormat,
    streamUnheard: row.streamUnheard ?? false,
    genre: row.genre ?? null,
    note: row.note ?? null,
    callSign: row.callSign ?? null,
    frequency: row.frequency ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    catalogChecked: row.catalogChecked,
    callSignUnlicensed: heldForCallSign(row),
    isNew: row.notifiedAt === undefined,
  };
}

// Pending suggestions, but only on a day something new arrived: an inbox
// that repeats yesterday's list with nothing added is noise.
export const listStationDigest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (!pending.some((row) => row.notifiedAt === undefined)) return [];
    const rows: StationDigestRow[] = [];
    for (const row of pending) rows.push(await digestRow(ctx, row));
    return rows;
  },
});

export const markStationDigestSent = internalMutation({
  args: { ids: v.array(v.id("freightFateStationSuggestions")), now: v.number() },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      if (await ctx.db.get(id)) await ctx.db.patch(id, { notifiedAt: args.now });
    }
  },
});

// -- review links -----------------------------------------------------------------------

type StationClaim = {
  id: Id<"freightFateStationSuggestions">;
  decision: ReviewDecision;
  createdAt: number;
  expiresAt: number;
};

// "station" leads the signed body so a career review token can never be
// replayed as a station decision, or the other way round.
export async function signStationClaim(claim: StationClaim) {
  const secret = reviewSecret();
  if (!secret) return null;
  const body = ["station", claim.id, claim.decision, claim.createdAt, claim.expiresAt].join(".");
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyStationClaim(token: string, now: number): Promise<StationClaim | null> {
  const secret = reviewSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "station") return null;
  const [, id, decision, created, expires, mac] = parts;
  const body = ["station", id, decision, created, expires].join(".");
  if (!sameText(mac, await hmacHex(secret, body))) return null;
  if (decision !== "accepted" && decision !== "declined") return null;
  const createdAt = Number(created);
  const expiresAt = Number(expires);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  return { id: id as Id<"freightFateStationSuggestions">, decision, createdAt, expiresAt };
}

export const getStationReviewRow = internalQuery({
  args: { id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return { ...(await digestRow(ctx, row)), status: row.status };
  },
});

/**
 * An AM or FM suggestion whose call sign the FCC does not list. Accepting
 * skips it: it waits until it is made web radio
 * (freightFateStationAdmin:makeWebStation) or declined.
 */
export function heldForCallSign(row: Doc<"freightFateStationSuggestions">) {
  return row.status === "pending" && row.kind === "terrestrial" && row.placement === "not_found";
}

async function decide(
  ctx: MutationCtx,
  row: Doc<"freightFateStationSuggestions">,
  decision: ReviewDecision,
  now: number,
) {
  await ctx.db.patch(row._id, { status: decision, decidedAt: now });
  if (decision === "accepted" && row.kind === "terrestrial" && row.callSign) {
    await ctx.scheduler.runAfter(0, internal.freightFateStationPlacement.placeStation, { id: row._id });
  }
}

export const decideStationSuggestion = internalMutation({
  args: {
    id: v.id("freightFateStationSuggestions"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
    createdAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "pending" || row.createdAt !== args.createdAt) {
      return { ok: false as const };
    }
    if (args.decision === "accepted" && heldForCallSign(row)) return { ok: false as const, held: true as const, name: row.name };
    await decide(ctx, row, args.decision, args.now);
    if (args.decision === "accepted") await recordStationNews(ctx, [row], args.now);
    return { ok: true as const, name: row.name, kind: row.kind };
  },
});

// -- the review page's link -------------------------------------------------------------

// One link per digest, good for every suggestion that was pending when it was
// signed. "stations" leads the signed body so neither kind of single-decision
// token can be replayed as one.
type BatchClaim = { issuedAt: number; expiresAt: number };

/** The most stations one decision covers; the page sends what is ticked. */
export const MAX_BATCH_DECISION = 200;

export async function signStationBatch(claim: BatchClaim) {
  const secret = reviewSecret();
  if (!secret) return null;
  const body = ["stations", claim.issuedAt, claim.expiresAt].join(".");
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyStationBatch(token: string, now: number): Promise<BatchClaim | null> {
  const secret = reviewSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "stations") return null;
  const [, issued, expires, mac] = parts;
  const body = ["stations", issued, expires].join(".");
  if (!sameText(mac, await hmacHex(secret, body))) return null;
  const issuedAt = Number(issued);
  const expiresAt = Number(expires);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  return { issuedAt, expiresAt };
}

export type ReviewStation = {
  id: Id<"freightFateStationSuggestions">;
  name: string;
  streamUrl: string;
  kind: "terrestrial" | "web";
  /** Accept skips it until it is made web radio (heldForCallSign). */
  held: boolean;
  facts: Array<[string, string]>;
};

async function reviewStation(ctx: QueryCtx, row: Doc<"freightFateStationSuggestions">): Promise<ReviewStation> {
  return {
    id: row._id,
    name: row.name,
    streamUrl: row.streamUrl,
    kind: row.kind,
    held: heldForCallSign(row),
    facts: stationFacts(await digestRow(ctx, row)),
  };
}

/** A suggestion the review link covers and that still waits, or null. */
async function reviewable(ctx: QueryCtx, id: Id<"freightFateStationSuggestions">, issuedAt: number) {
  const row = await ctx.db.get(id);
  return row && row.status === "pending" && row.createdAt <= issuedAt ? row : null;
}

type ReviewFix = { ok: true; station: ReviewStation } | { ok: false; problem: string };
const GONE = "This suggestion is no longer waiting for review. Reload the page.";

/** A new stream address for a suggestion on the review page. */
export const reviewChangeStream = internalMutation({
  args: { id: v.id("freightFateStationSuggestions"), issuedAt: v.number(), streamUrl: v.string() },
  handler: async (ctx, args): Promise<ReviewFix> => {
    const row = await reviewable(ctx, args.id, args.issuedAt);
    if (!row) return { ok: false, problem: GONE };
    const changed = await changeStreamUrl(ctx, row, args.streamUrl);
    if (!changed.ok) return changed;
    return { ok: true, station: await reviewStation(ctx, (await ctx.db.get(row._id))!) };
  },
});

/** The review page's copy of one suggestion, after the stream check wrote to it. */
export const reviewStationRow = internalQuery({
  args: { id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    return row ? reviewStation(ctx, row) : null;
  },
});

export const reviewMakeWeb = internalMutation({
  args: { id: v.id("freightFateStationSuggestions"), issuedAt: v.number() },
  handler: async (ctx, args): Promise<ReviewFix> => {
    const row = await reviewable(ctx, args.id, args.issuedAt);
    if (!row) return { ok: false, problem: GONE };
    await makeWeb(ctx, row);
    return { ok: true, station: await reviewStation(ctx, (await ctx.db.get(row._id))!) };
  },
});

/** Turns a suggestion on the review page into web radio, so Accept takes it. */
export const makeStationWebFromReview = action({
  args: { token: v.string(), id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args): Promise<{ ok: false; expired: true } | ReviewFix> => {
    const claim = await verifyStationBatch(args.token, Date.now());
    if (!claim) return { ok: false, expired: true };
    return ctx.runMutation(internal.freightFateStations.reviewMakeWeb, { id: args.id, issuedAt: claim.issuedAt });
  },
});

export const pendingStationsFor = internalQuery({
  args: { issuedAt: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const stations: ReviewStation[] = [];
    for (const row of pending) {
      if (row.createdAt > args.issuedAt) continue;
      stations.push(await reviewStation(ctx, row));
    }
    return stations.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const decideStations = internalMutation({
  args: {
    ids: v.array(v.id("freightFateStationSuggestions")),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
    issuedAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const decided: Array<Doc<"freightFateStationSuggestions">> = [];
    const held: Array<Id<"freightFateStationSuggestions">> = [];
    for (const id of args.ids.slice(0, MAX_BATCH_DECISION)) {
      const row = await ctx.db.get(id);
      if (!row || row.status !== "pending" || row.createdAt > args.issuedAt) continue;
      if (args.decision === "accepted" && heldForCallSign(row)) {
        held.push(row._id);
        continue;
      }
      await decide(ctx, row, args.decision, args.now);
      decided.push(row);
    }
    // One What's New announcement per accepted batch, written with it.
    if (args.decision === "accepted") await recordStationNews(ctx, decided, args.now);
    return { decided: decided.map((row) => row._id), held };
  },
});

/** What the review page lists: every suggestion its link covers that still waits. */
export const reviewStationBatch = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ ok: false } | { ok: true; stations: ReviewStation[] }> => {
    const claim = await verifyStationBatch(args.token, Date.now());
    if (!claim) return { ok: false };
    const stations: ReviewStation[] = await ctx.runQuery(internal.freightFateStations.pendingStationsFor, {
      issuedAt: claim.issuedAt,
    });
    return { ok: true, stations };
  },
});

/** Accepts or declines the ticked stations; answers with the ones it decided. */
export const decideStationBatch = action({
  args: {
    token: v.string(),
    ids: v.array(v.id("freightFateStationSuggestions")),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: false }
    | { ok: true; decided: Array<Id<"freightFateStationSuggestions">>; held: Array<Id<"freightFateStationSuggestions">> }
  > => {
    const now = Date.now();
    const claim = await verifyStationBatch(args.token, now);
    if (!claim) return { ok: false };
    const result: { decided: Array<Id<"freightFateStationSuggestions">>; held: Array<Id<"freightFateStationSuggestions">> } =
      await ctx.runMutation(internal.freightFateStations.decideStations, {
        ids: args.ids,
        decision: args.decision,
        issuedAt: claim.issuedAt,
        now,
      });
    return { ok: true, ...result };
  },
});

// -- pages --------------------------------------------------------------------------------

/** The facts the reviewer judges, as plain lines. Shared with the digest. */
export function stationFacts(row: StationDigestRow) {
  const kind = row.kind === "terrestrial" ? "Terrestrial" : "Web radio";
  const where = [row.city, row.state].filter(Boolean).join(", ");
  const facts: Array<[string, string]> = [
    ["Type", kind],
    [
      "Stream",
      row.streamUnheard
        ? `${row.streamUrl} (did not answer the check; listen before accepting)`
        : `${row.streamUrl} (${row.streamFormat})`,
    ],
  ];
  if (row.callSign) {
    facts.push([
      "Call sign",
      row.callSignUnlicensed
        ? `${row.callSign}. The FCC lists no station with this call sign, so Accept skips it. Decline it, or make it web radio.`
        : row.callSign,
    ]);
  }
  if (row.frequency) facts.push(["Frequency", row.frequency]);
  if (where) facts.push(["Where", where]);
  if (row.genre) facts.push(["Format", row.genre]);
  if (row.note) facts.push(["Note", row.note]);
  facts.push([
    "Suggested by",
    row.driverId === ANONYMOUS_SUGGESTER ? "Someone not signed in" : `${row.displayName} (${row.driverId})`,
  ]);
  if (!row.catalogChecked) {
    facts.push(["Dial check", "The shipped station list could not be read; check it is not already on the dial."]);
  }
  return facts;
}

const VERB: Record<ReviewDecision, string> = { accepted: "Accept", declined: "Decline" };

const unusable = () =>
  page(
    "This review link does not work",
    "<p>It has expired, or it was changed. The next station digest carries fresh links for every suggestion still waiting.</p>",
    400,
  );

export const stationReviewPage = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const claim = await verifyStationClaim(token, Date.now());
  if (!claim) return unusable();
  const row = await ctx.runQuery(internal.freightFateStations.getStationReviewRow, { id: claim.id });
  if (!row) return page("This suggestion is gone", "<p>It was removed.</p>", 404);
  if (row.status !== "pending" || row.createdAt !== claim.createdAt) {
    return page("Already decided", `<p>${escapeHtml(row.name)} is no longer waiting for review.</p>`);
  }
  const verb = VERB[claim.decision];
  const effect = claim.decision === "declined"
    ? "It stays off the dial, and the same stream cannot be suggested again."
    : row.kind === "terrestrial"
      ? "It goes on the dial at players' next launch, heard everywhere until you add its transmitter's lat, lon and rangeMiles to its row."
      : "It goes on the dial at players' next launch.";
  const facts = stationFacts(row)
    .map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("\n");
  return page(
    `${verb} ${row.name}?`,
    `<dl>
${facts}
</dl>
<p>${effect}</p>
<form method="post">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<button type="submit">${verb} this station</button>
</form>`,
  );
});

export const decideStationFromPage = httpAction(async (ctx, request) => {
  const form = await request.formData().catch(() => null);
  const token = typeof form?.get("t") === "string" ? (form.get("t") as string) : "";
  const claim = await verifyStationClaim(token, Date.now());
  if (!claim) return unusable();
  const result = await ctx.runMutation(internal.freightFateStations.decideStationSuggestion, {
    id: claim.id,
    decision: claim.decision,
    createdAt: claim.createdAt,
    now: Date.now(),
  });
  if (!result.ok) {
    if ("held" in result) {
      return page(
        `Not accepted: ${result.name}`,
        "<p>The FCC lists no station with its call sign. Decline it, or make it web radio from the review page in the latest station digest.</p>",
      );
    }
    return page("Already decided", "<p>This suggestion is no longer waiting for review.</p>");
  }
  if (claim.decision === "declined") {
    return page(`Declined: ${result.name}`, "<p>It stays off the dial.</p>");
  }
  const next = result.kind === "terrestrial"
    ? "<p>It is on the dial from players' next launch. Its transmitter is being looked up in the FCC's licence records; once found, it plays on the AM and FM band near home. If the FCC does not list it, it plays everywhere, the way web radio does.</p>"
    : "<p>It is on the dial from players' next launch.</p>";
  return page(`Accepted: ${result.name}`, next);
});
