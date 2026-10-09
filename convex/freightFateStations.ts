// Player-suggested radio stations: the gate a suggestion passes before it is
// stored, the owner's review, and the community station list the game
// downloads so new stations reach the dial without a game release.
//
// The order of a suggestion's life: freightFateStationVetting.ts checks the
// form, asks admitSuggestion whether this driver may suggest it at all (signed
// in, under the limits, not a stream already suggested), probes the stream
// and the shipped catalog, then recordSuggestion stores it as pending. The
// daily station digest emails one Accept and one Decline link per pending
// suggestion; the pages here answer those links the same way the career
// review pages do (a link only opens a page, the decision is a POST from it).
import { httpAction, internalMutation, internalQuery, query } from "./_generated/server";
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
import { DAILY_SUGGESTION_LIMIT, refuse, type Refusal } from "./freightFateStationRules";

// Suggestion attempts per driver per minute, counted before the stream is
// probed, so a refused probe still costs one. The daily limit counts only
// suggestions that were stored.
export const STATION_SUGGEST_WRITE_LIMIT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// Nightly checks an accepted stream may fail in a row before it leaves the
// list. Three nights rides out a station's maintenance window; one that
// answers again comes straight back.
export const STATION_DEAD_AFTER = 3;

export const STATION_LINK_TTL_MS = 14 * DAY_MS;

// -- the gate -------------------------------------------------------------------

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
    streamKey: v.string(),
    callSignBase: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ ok: true; driverId: string } | Refusal> => {
    const driver = await suggestingDriver(ctx, args);
    if (!driver) return refuse("driver_not_found");
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "station-suggest",
      driverId: driver.driverId,
      now: args.now,
      limit: STATION_SUGGEST_WRITE_LIMIT,
    });
    if (!allowed) return refuse("rate_limited");
    if (args.authSubject === undefined) {
      if (!args.driverTokenHash || !(await driverTokenAccepted(ctx, driver, args.driverTokenHash))) {
        return refuse("unauthorized");
      }
    }
    const today = await ctx.db
      .query("freightFateStationSuggestions")
      .withIndex("by_driver_created", (q) =>
        q.eq("driverId", driver.driverId).gt("createdAt", args.now - DAY_MS))
      .take(DAILY_SUGGESTION_LIMIT);
    if (today.length >= DAILY_SUGGESTION_LIMIT) return refuse("daily_limit");
    const duplicate = await findDuplicate(ctx, args.streamKey, args.callSignBase);
    if (duplicate) return duplicate;
    return { ok: true, driverId: driver.driverId };
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
    genre: v.optional(v.string()),
    note: v.optional(v.string()),
    callSign: v.optional(v.string()),
    callSignBase: v.optional(v.string()),
    frequency: v.optional(v.string()),
    frequencyMhz: v.optional(v.number()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    catalogChecked: v.boolean(),
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
  args: { id: v.id("freightFateStationSuggestions"), ok: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(args.id, {
      lastCheckedAt: args.now,
      failedChecks: args.ok ? 0 : (row.failedChecks ?? 0) + 1,
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
  genre: string | null;
  note: string | null;
  callSign: string | null;
  frequency: string | null;
  city: string | null;
  state: string | null;
  catalogChecked: boolean;
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
    genre: row.genre ?? null,
    note: row.note ?? null,
    callSign: row.callSign ?? null,
    frequency: row.frequency ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    catalogChecked: row.catalogChecked,
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
    await ctx.db.patch(args.id, { status: args.decision, decidedAt: args.now });
    if (args.decision === "accepted" && row.kind === "terrestrial" && row.callSign) {
      await ctx.scheduler.runAfter(0, internal.freightFateStationPlacement.placeStation, { id: args.id });
    }
    return { ok: true as const, name: row.name, kind: row.kind };
  },
});

// -- pages --------------------------------------------------------------------------------

/** The facts the reviewer judges, as plain lines. Shared with the digest. */
export function stationFacts(row: StationDigestRow) {
  const kind = row.kind === "terrestrial" ? "Terrestrial" : "Web radio";
  const where = [row.city, row.state].filter(Boolean).join(", ");
  const facts: Array<[string, string]> = [
    ["Type", kind],
    ["Stream", `${row.streamUrl} (${row.streamFormat})`],
  ];
  if (row.callSign) facts.push(["Call sign", row.callSign]);
  if (row.frequency) facts.push(["Frequency", row.frequency]);
  if (where) facts.push(["Where", where]);
  if (row.genre) facts.push(["Format", row.genre]);
  if (row.note) facts.push(["Note", row.note]);
  facts.push(["Suggested by", `${row.displayName} (${row.driverId})`]);
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
