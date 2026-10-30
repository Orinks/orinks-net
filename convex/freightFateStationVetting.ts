"use node";

// The automatic half of a station suggestion's review: before the owner sees
// anything, the stream has to answer with audio the game can play, and the
// station must not already be on the dial or already suggested. Also the
// nightly re-check of accepted streams and the daily station digest email.
//
// The probe opens its own socket to an address it has already checked is
// public, rather than handing the URL to fetch: a player chooses this URL,
// and the server must never be talked into reaching something on its own
// network (or one a DNS answer swaps in between the check and the connect).
// It speaks HTTP/1.0 with Icy-MetaData off, which is also the only way to
// hear a Shoutcast v1 server, whose "ICY 200 OK" greeting fetch rejects.
import { lookup } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  SUGGESTION_RECEIVED,
  SUGGESTION_RECEIVED_UNHEARD,
  callSignBase,
  isPublicAddress,
  judgeProbe,
  looksLikeHomepage,
  type ListedStation,
  MAX_LISTED_STATIONS,
  MAX_NAME_LENGTH,
  dechunk,
  normalizeStreamUrl,
  previewPlayable,
  refuse,
  validateSuggestion,
  type Refusal,
  type StationSuggestionInput,
} from "./freightFateStationRules";
import {
  type ReviewStation,
  STATION_LINK_TTL_MS,
  signStationBatch,
  type StationDigestRow,
  verifyStationBatch,
} from "./freightFateStations";
import { escapeHtml } from "./freightFateReview";
import { fccLicenses } from "./freightFateStationPlacement";
import { humanCheck } from "./turnstile";

const PROBE_TIMEOUT_MS = 8_000;
// The whole probe, redirects and one playlist hop included. The game waits on
// this answer with the player listening, and the site route has a minute.
const PROBE_BUDGET_MS = 20_000;
const PROBE_MAX_BYTES = 16 * 1024;
// Enough bytes to be audio rather than an error page that sniffed lucky.
const PROBE_MIN_AUDIO_BYTES = 512;
// An error reply this big and written in HTML is a site's page, not a stream
// server's error. A station's homepage behind bot protection answers 403 or
// 503 with a page of several kilobytes; Icecast and Shoutcast say 403 or 404
// in a page of a few hundred bytes, and those keep their status.
const WEB_PAGE_ERROR_BYTES = 1024;
const MAX_REDIRECTS = 5;
const PROBE_USER_AGENT = "FreightFate-StationCheck/1 (+https://orinks.net/freight-fate)";

/**
 * Why a stream that did not answer with audio failed, for the reviewer:
 * the name did not resolve, nothing would connect, it connected and said
 * nothing, or it answered with an HTTP status other than success. A check
 * that threw or ran out of time says so rather than blame the server.
 */
export type ProbeProblem =
  | "no_address"
  | "no_connection"
  | "no_reply"
  | "too_little_audio"
  | "too_many_redirects"
  | "check_failed"
  | `http_${number}`;

export type ProbeResult =
  | { ok: true; format: string; name?: string; playUrl: string }
  | { ok: false; reason: "stream_unreachable"; problem: ProbeProblem }
  | { ok: false; reason: "stream_address_blocked" | "stream_web_page" | "stream_not_audio" }
  | { ok: false; reason: "stream_station_list"; stations: ListedStation[] };

type RawReply = { status: number; headers: Map<string, string>; body: Uint8Array };

async function publicAddressFor(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) return { blocked: false, address: null };
  if (!addresses.every((entry) => isPublicAddress(entry.address))) {
    return { blocked: true, address: null };
  }
  return { blocked: false, address: addresses[0].address };
}

/** One HTTP/1.0 GET to an already-checked address, cut off at PROBE_MAX_BYTES. */
function rawGet(url: URL, address: string, timeoutMs: number): Promise<RawReply | "no_connection" | "no_reply"> {
  return new Promise((resolve) => {
    const secure = url.protocol === "https:";
    const port = Number(url.port) || (secure ? 443 : 80);
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let connected = false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const socket: Socket = secure
      ? tlsConnect({ host: address, port, servername: isIP(host) ? undefined : host })
      : new Socket().connect(port, address);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const reply = parseReply(Buffer.concat(chunks));
      // A refused connection, a TLS failure, or a connect that never
      // completed reads as no connection; one that opened and then went
      // quiet or was cut as no reply.
      resolve(reply ?? (connected ? "no_reply" : "no_connection"));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.once(secure ? "secureConnect" : "connect", () => {
      connected = true;
      socket.write(
        `GET ${url.pathname || "/"}${url.search} HTTP/1.0\r\n` +
          `Host: ${url.host}\r\n` +
          `User-Agent: ${PROBE_USER_AGENT}\r\n` +
          "Icy-MetaData: 0\r\nAccept: */*\r\nConnection: close\r\n\r\n",
      );
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= PROBE_MAX_BYTES) finish();
    });
    socket.once("end", finish);
    socket.once("close", finish);
    socket.once("error", finish);
  });
}

function parseReply(raw: Buffer): RawReply | null {
  const split = raw.indexOf("\r\n\r\n");
  const headEnd = split === -1 ? raw.indexOf("\n\n") : split;
  if (headEnd === -1) return null;
  const head = raw.subarray(0, headEnd).toString("latin1").split(/\r?\n/);
  const status = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(head[0] ?? "");
  if (!status) return null;
  const headers = new Map<string, string>();
  for (const line of head.slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  const body = new Uint8Array(raw.subarray(headEnd + (split === -1 ? 2 : 4)));
  return {
    status: Number(status[1]),
    headers,
    body: /chunked/i.test(headers.get("transfer-encoding") ?? "") ? dechunk(body) : body,
  };
}

/** Follow the address to a stream and say what it plays, or why it does not. */
export function probeStream(address: string) {
  return probeWith(address, publicAddressFor, 0, Date.now() + PROBE_BUDGET_MS);
}

type Resolver = (hostname: string) => Promise<{ blocked: boolean; address: string | null }>;

type Fetched =
  | { reply: RawReply; url: URL }
  | { ok: false; reason: "stream_unreachable"; problem: ProbeProblem }
  | { ok: false; reason: "stream_address_blocked" | "stream_web_page" };

const unreachable = (problem: ProbeProblem) => ({ ok: false as const, reason: "stream_unreachable" as const, problem });

/** One address fetched through its redirects, each hop to a checked public address. */
async function fetchFollowing(address: string | URL, resolve: Resolver, deadline: number): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return unreachable("no_address");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return unreachable("no_address");
    const target = await resolve(url.hostname);
    if (target.blocked) return { ok: false, reason: "stream_address_blocked" };
    if (!target.address) return unreachable("no_address");
    const remaining = Math.min(PROBE_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) return unreachable("check_failed");
    const reply = await rawGet(url, target.address, remaining);
    if (typeof reply === "string") return unreachable(reply);
    const location = reply.headers.get("location");
    if (reply.status >= 300 && reply.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return unreachable(`http_${reply.status}`);
      }
      continue;
    }
    if (reply.status !== 200) {
      if (
        reply.body.length >= WEB_PAGE_ERROR_BYTES &&
        judgeProbe(reply.headers.get("content-type") ?? "", reply.body).verdict === "web_page"
      ) {
        return { ok: false, reason: "stream_web_page" };
      }
      return unreachable(`http_${reply.status}`);
    }
    return { reply, url };
  }
  return unreachable("too_many_redirects");
}

/** The first URI an HLS playlist lists: a variant of a master playlist, or a segment. */
function firstHlsUri(text: string, base: URL) {
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) continue;
    try {
      return { url: new URL(entry, base), master: /#EXT-X-STREAM-INF/.test(text) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * An HLS stream plays when its media playlist names a segment that answers
 * with more than an error page. A master playlist leads to its first variant.
 */
async function probeHls(
  text: string,
  base: URL,
  address: string,
  resolve: Resolver,
  deadline: number,
): Promise<ProbeResult> {
  let next = firstHlsUri(text, base);
  for (let level = 0; next?.master && level < 2; level += 1) {
    const variant = await fetchFollowing(next.url, resolve, deadline);
    if (!("reply" in variant)) return variant;
    next = firstHlsUri(new TextDecoder().decode(variant.reply.body), variant.url);
  }
  if (!next || next.master) return { ok: false, reason: "stream_not_audio" };
  const segment = await fetchFollowing(next.url, resolve, deadline);
  if (!("reply" in segment)) return segment;
  const type = segment.reply.headers.get("content-type") ?? "";
  if (judgeProbe(type, segment.reply.body).verdict === "web_page") return { ok: false, reason: "stream_web_page" };
  if (!previewPlayable(type)) return { ok: false, reason: "stream_not_audio" };
  if (segment.reply.body.length < PROBE_MIN_AUDIO_BYTES) return unreachable("too_little_audio");
  return { ok: true, format: "hls", playUrl: address };
}

/** probeStream with the address check supplied: tests point it at a local server. */
export async function probeWith(
  address: string,
  resolve: Resolver,
  depth: number,
  deadline: number,
): Promise<ProbeResult> {
  const fetched = await fetchFollowing(address, resolve, deadline);
  if (!("reply" in fetched)) return fetched;
  const { reply, url } = fetched;
  const verdict = judgeProbe(reply.headers.get("content-type") ?? "", reply.body);
  switch (verdict.verdict) {
    case "audio":
      if (reply.body.length < PROBE_MIN_AUDIO_BYTES) return unreachable("too_little_audio");
      return {
        ok: true,
        format: verdict.format,
        ...(reply.headers.get("icy-name")?.trim() ? { name: reply.headers.get("icy-name")!.trim().slice(0, MAX_NAME_LENGTH) } : {}),
        // The address before its redirects: a CDN can tie the address it
        // redirects to to the server that asked, here the check's and not
        // the preview's.
        playUrl: address,
      };
    case "hls":
      return probeHls(new TextDecoder().decode(reply.body), url, address, resolve, deadline);
    case "playlist":
      // The game resolves a playlist at play time; one level is all a
      // station's playlist ever needs, and it must lead to real audio.
      if (!verdict.next || depth > 0) return { ok: false, reason: "stream_not_audio" };
      return probeWith(verdict.next, resolve, depth + 1, deadline);
    case "station_list":
      return { ok: false, reason: "stream_station_list", stations: verdict.stations };
    case "web_page":
      return { ok: false, reason: "stream_web_page" };
    default:
      return { ok: false, reason: "stream_not_audio" };
  }
}

/** What the review page says about one stream's check, read by a screen reader. */
export function describeProbe(probe: ProbeResult) {
  if (probe.ok) return `Plays (${probe.format.toUpperCase()})`;
  switch (probe.reason) {
    case "stream_unreachable":
      switch (probe.problem) {
        case "no_address":
          return "Fails: the address does not lead to a server";
        case "no_connection":
          return "Fails: nothing answered. The server may be down, or may block listeners outside its country";
        case "no_reply":
          return "Fails: the server sent nothing back";
        case "too_little_audio":
          return "Fails: the stream stopped after a moment";
        case "too_many_redirects":
          return "Fails: the address redirects too many times";
        case "check_failed":
          return "Fails: the check could not finish. Reload the page to try again";
        case "http_403":
        case "http_451":
          return `Fails: the server refused it (error ${probe.problem.slice(5)}). Some stations refuse listeners outside their country`;
        case "http_404":
        case "http_410":
          return `Fails: the server has no stream at this address (error ${probe.problem.slice(5)}), so it is probably dead`;
        default:
          return `Fails: the server answered with error ${probe.problem.slice(5)}`;
      }
    case "stream_web_page":
      return "Fails: the address is a web page, not a stream";
    case "stream_not_audio":
      return "Fails: the address answers, but not with audio";
    case "stream_address_blocked":
      return "Fails: the address points at a private network";
    case "stream_station_list":
      return "Fails: the address lists several stations";
  }
}

// -- the shipped catalog -------------------------------------------------------------

// The game's own station lists, read from the repository so the duplicate
// check matches what players have without a copy here to fall out of date.
// Cached for an hour per warm instance: suggestions are rare, the files are
// a few megabytes, and a station added to the shipped list in the last hour
// is still dropped by the game itself on load.
const CATALOG_FILES = ["radio_catalog.json", "radio_imported.json"];
const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache: { at: number; streams: Set<string>; callSigns: Set<string> } | null = null;

async function shippedCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache;
  const base = (process.env.FREIGHT_FATE_CATALOG_BASE_URL ??
    "https://raw.githubusercontent.com/orinks-games/Freight-Fate/main/data").replace(/\/$/, "");
  const streams = new Set<string>();
  const callSigns = new Set<string>();
  try {
    for (const file of CATALOG_FILES) {
      const response = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const data = (await response.json()) as { stations?: Array<Record<string, unknown>> };
      for (const station of data.stations ?? []) {
        if (typeof station.stream_url === "string" && station.stream_url) {
          streams.add(normalizeStreamUrl(station.stream_url));
        }
        if (typeof station.call_sign === "string" && station.call_sign.trim()) {
          callSigns.add(callSignBase(station.call_sign));
        }
      }
    }
  } catch {
    return null;
  }
  catalogCache = { at: Date.now(), streams, callSigns };
  return catalogCache;
}

// -- suggesting -------------------------------------------------------------------------

const formArgs = {
  kind: v.optional(v.string()),
  name: v.optional(v.string()),
  streamUrl: v.optional(v.string()),
  callSign: v.optional(v.string()),
  frequency: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  genre: v.optional(v.string()),
  note: v.optional(v.string()),
};

type SuggestResult =
  | { ok: true; message: string }
  | Refusal
  // A playlist of several stations, offered to the site form's picker.
  | (Refusal & { reason: "stream_station_list"; stations: ListedStation[]; remaining: number });

type Who = { driverId?: string; driverTokenHash?: string; authSubject?: string; anonymous?: boolean };

/**
 * One suggestion, checked and stored. A station picked from a playlist
 * (listed) may arrive without a name, and takes the one its stream announces;
 * only the first of a picker send spends a rate-limit attempt.
 */
async function vetAndRecord(
  ctx: ActionCtx,
  who: Who,
  input: StationSuggestionInput,
  clientVersion: string | undefined,
  listed?: { spendAttempt: boolean },
): Promise<SuggestResult> {
  // An online station may come without a name only when its address is a
  // playlist of several, which goes to the picker; a single station still
  // needs one. A station picked from that playlist takes the name its
  // stream announces when the playlist gave none.
  const unnamed = (listed !== undefined || input.kind === "web") && !(typeof input.name === "string" && input.name.trim());
  const checked = validateSuggestion(unnamed ? { ...input, name: "unnamed" } : input);
  if (!checked.ok) return checked;
  const suggestion = checked.value;
  const now = Date.now();
  const admitted: { ok: true; driverId: string } | Refusal = await ctx.runMutation(
    internal.freightFateStations.admitSuggestion,
    {
      ...who,
      streamKey: suggestion.streamKey,
      callSignBase: suggestion.callSignBase,
      now,
      ...(listed ? { spendAttempt: listed.spendAttempt } : {}),
    },
  );
  if (!admitted.ok) return admitted;

  const catalog = await shippedCatalog().catch(() => null);
  if (
    catalog &&
    (catalog.streams.has(suggestion.streamKey) ||
      (suggestion.callSignBase !== undefined && catalog.callSigns.has(suggestion.callSignBase)))
  ) {
    return refuse("duplicate_catalog");
  }
  // A stream that does not answer goes to review rather than back to the
  // player: it may play fine for them and only turn this server away. An
  // answer that is clearly not a station (a web page, a private address,
  // something that is not audio) is still refused on the spot.
  const probe: ProbeResult = await probeStream(suggestion.streamUrl).catch(() => unreachable("check_failed"));
  if (!probe.ok && probe.reason === "stream_station_list") {
    // Only the site form offers a picker, and only for online stations: an
    // AM or FM station is one station with one call sign.
    if (listed || suggestion.kind !== "web" || !(who.authSubject !== undefined || who.anonymous)) {
      return refuse("stream_station_list");
    }
    const remaining: number = await ctx.runQuery(internal.freightFateStations.suggestionAllowance, {
      ...(who.authSubject !== undefined ? { authSubject: who.authSubject } : {}),
      ...(who.anonymous ? { anonymous: true } : {}),
      now,
    });
    if (remaining <= 0) return refuse(who.anonymous ? "station_list_used_up_anonymous" : "station_list_used_up");
    return { ...refuse("stream_station_list"), reason: "stream_station_list", stations: probe.stations, remaining };
  }
  if (!probe.ok && probe.reason !== "stream_unreachable") return refuse(probe.reason);
  if (!probe.ok && looksLikeHomepage(suggestion.streamUrl)) return refuse("stream_web_page");
  const heard = probe.ok;
  let name = suggestion.name;
  if (unnamed) {
    if (!listed) return refuse("invalid_name");
    if (!probe.ok || !probe.name) return refuse("no_station_name");
    name = probe.name;
  }

  // An AM or FM station whose call sign the FCC does not list is still
  // taken, but held: the review page will not accept it as broadcast radio.
  const licensed =
    suggestion.kind === "terrestrial" && suggestion.callSign
      ? await fccLicenses({ callSign: suggestion.callSign, state: suggestion.state, frequency: suggestion.frequency })
      : null;

  const recorded: { ok: true } | Refusal = await ctx.runMutation(
    internal.freightFateStations.recordSuggestion,
    {
      ...suggestion,
      name,
      driverId: admitted.driverId,
      streamFormat: probe.ok ? probe.format : "unknown",
      ...(heard ? {} : { streamUnheard: true }),
      catalogChecked: catalog !== null,
      ...(licensed === false ? { placement: "not_found" as const, placementCheckedAt: now } : {}),
      ...(clientVersion ? { clientVersion } : {}),
      now,
    },
  );
  if (!recorded.ok) return recorded;
  return { ok: true, message: heard ? SUGGESTION_RECEIVED : SUGGESTION_RECEIVED_UNHEARD };
}

const listArgs = {
  stations: v.array(v.object({ name: v.string(), streamUrl: v.string() })),
  genre: v.optional(v.string()),
  note: v.optional(v.string()),
};

export type ListedOutcome = { name: string; streamUrl: string; ok: boolean; reason?: string };

/**
 * The stations picked from one playlist, each a suggestion of its own under
 * the usual daily allowance. Picks past what is left today are refused
 * without being checked.
 */
async function vetListed(
  ctx: ActionCtx,
  who: Who,
  args: { stations: ListedStation[]; genre?: string; note?: string },
): Promise<{ ok: true; results: ListedOutcome[] }> {
  const remaining: number = await ctx.runQuery(internal.freightFateStations.suggestionAllowance, {
    ...(who.authSubject !== undefined ? { authSubject: who.authSubject } : {}),
    ...(who.anonymous ? { anonymous: true } : {}),
    now: Date.now(),
  });
  const picks = args.stations.slice(0, MAX_LISTED_STATIONS);
  const results = await Promise.all(
    picks.map(async (station, index): Promise<ListedOutcome> => {
      const outcome = { name: station.name, streamUrl: station.streamUrl };
      if (index >= remaining) {
        return { ...outcome, ok: false, reason: who.anonymous ? "anonymous_limit" : "daily_limit" };
      }
      const result = await vetAndRecord(
        ctx,
        who,
        { kind: "web", name: station.name, streamUrl: station.streamUrl, genre: args.genre, note: args.note },
        undefined,
        { spendAttempt: index === 0 },
      );
      return result.ok ? { ...outcome, ok: true } : { ...outcome, ok: false, reason: result.reason };
    }),
  );
  return { ok: true, results };
}

/** Stations picked from a playlist on the site form, by a signed-in driver. */
export const suggestListedStationsSignedIn = action({
  args: listArgs,
  handler: async (ctx, args): Promise<{ ok: true; results: ListedOutcome[] } | Refusal> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return refuse("driver_not_found");
    return vetListed(ctx, { authSubject: identity.subject }, args);
  },
});

/** The same from a visitor not signed in; one human check covers the send. */
export const suggestListedStationsAnonymous = action({
  args: { turnstileToken: v.string(), ...listArgs },
  handler: async (ctx, args): Promise<{ ok: true; results: ListedOutcome[] } | Refusal> => {
    const { turnstileToken, ...rest } = args;
    const check = await humanCheck(turnstileToken);
    if (check.result === "unconfigured") return refuse("not_configured");
    if (check.result !== "passed") return refuse("human_check");
    return vetListed(ctx, { anonymous: true }, rest);
  },
});

/** The game's suggestion, authenticated by the driver token it already holds. */
export const suggestStation = action({
  args: {
    driverId: v.string(),
    driverTokenHash: v.string(),
    clientVersion: v.optional(v.string()),
    ...formArgs,
  },
  handler: async (ctx, args): Promise<SuggestResult> => {
    const { driverId, driverTokenHash, clientVersion, ...form } = args;
    return vetAndRecord(ctx, { driverId, driverTokenHash }, form, clientVersion);
  },
});

/** The site form's suggestion, from a signed-in orinks.net account's driver. */
export const suggestStationSignedIn = action({
  args: formArgs,
  handler: async (ctx, args): Promise<SuggestResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return refuse("driver_not_found");
    return vetAndRecord(ctx, { authSubject: identity.subject }, args, undefined);
  },
});

/**
 * The site form's suggestion from a visitor who is not signed in. The human
 * check stands in for the driver's sign-in, and every such visitor shares one
 * daily allowance (admitSuggestion), so the review email stays readable.
 */
export const suggestStationAnonymous = action({
  args: { turnstileToken: v.string(), ...formArgs },
  handler: async (ctx, args): Promise<SuggestResult> => {
    const { turnstileToken, ...form } = args;
    const check = await humanCheck(turnstileToken);
    if (check.result === "unconfigured") return refuse("not_configured");
    if (check.result !== "passed") return refuse("human_check");
    return vetAndRecord(ctx, { anonymous: true }, form, undefined);
  },
});

// -- the review page's check ------------------------------------------------------------

export type StationCheck = {
  id: Id<"freightFateStationSuggestions">;
  ok: boolean;
  text: string;
  /** Where the audio is once redirects and a playlist are followed. */
  playUrl?: string;
  format?: string;
};

const REVIEW_CHECK_PARALLEL = 12;

/**
 * Every station the review link covers, checked again now, so the page can
 * say which streams play from here and why the rest do not. A stream heard
 * for the first time loses its "did not answer" mark.
 */
export const checkStationBatch = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ ok: false } | { ok: true; checks: StationCheck[] }> => {
    const claim = await verifyStationBatch(args.token, Date.now());
    if (!claim) return { ok: false };
    const stations: ReviewStation[] = await ctx.runQuery(internal.freightFateStations.pendingStationsFor, {
      issuedAt: claim.issuedAt,
    });
    const checks: StationCheck[] = [];
    for (let start = 0; start < stations.length; start += REVIEW_CHECK_PARALLEL) {
      checks.push(
        ...(await Promise.all(
          stations.slice(start, start + REVIEW_CHECK_PARALLEL).map(async (station): Promise<StationCheck> => {
            const probe: ProbeResult = await probeStream(station.streamUrl).catch(() => unreachable("check_failed"));
            if (!probe.ok) return { id: station.id, ok: false, text: describeProbe(probe) };
            await ctx.runMutation(internal.freightFateStations.recordStationCheck, {
              id: station.id,
              ok: true,
              format: probe.format,
              now: Date.now(),
            });
            return { id: station.id, ok: true, text: describeProbe(probe), playUrl: probe.playUrl, format: probe.format };
          }),
        )),
      );
    }
    return { ok: true, checks };
  },
});

/**
 * A new stream address for one suggestion on the review page, checked at
 * once. An address that does not play from here is kept all the same: the
 * reviewer has heard it, or will decide on it.
 */
export const changeStationStream = action({
  args: { token: v.string(), id: v.id("freightFateStationSuggestions"), streamUrl: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: false; expired: true } | { ok: false; problem: string } | { ok: true; station: ReviewStation; check: StationCheck }> => {
    const claim = await verifyStationBatch(args.token, Date.now());
    if (!claim) return { ok: false, expired: true };
    const changed: { ok: true; station: ReviewStation } | { ok: false; problem: string } = await ctx.runMutation(
      internal.freightFateStations.reviewChangeStream,
      { id: args.id, issuedAt: claim.issuedAt, streamUrl: args.streamUrl },
    );
    if (!changed.ok) return changed;
    const probe: ProbeResult = await probeStream(changed.station.streamUrl).catch(() => unreachable("check_failed"));
    if (!probe.ok) {
      return { ok: true, station: changed.station, check: { id: args.id, ok: false, text: describeProbe(probe) } };
    }
    await ctx.runMutation(internal.freightFateStations.recordStationCheck, {
      id: args.id,
      ok: true,
      format: probe.format,
      now: Date.now(),
    });
    const station: ReviewStation | null = await ctx.runQuery(internal.freightFateStations.reviewStationRow, { id: args.id });
    return {
      ok: true,
      station: station ?? changed.station,
      check: { id: args.id, ok: true, text: describeProbe(probe), playUrl: probe.playUrl, format: probe.format },
    };
  },
});

// -- the nightly re-check ---------------------------------------------------------------

const RECHECK_BATCH = 200;
const RECHECK_PARALLEL = 8;

export const recheckAcceptedStations = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows: Array<{ id: Id<"freightFateStationSuggestions">; streamUrl: string; needsPlacement: boolean }> =
      await ctx.runQuery(internal.freightFateStations.stationsToRecheck, { limit: RECHECK_BATCH, now: Date.now() });
    for (let start = 0; start < rows.length; start += RECHECK_PARALLEL) {
      await Promise.all(
        rows.slice(start, start + RECHECK_PARALLEL).map(async (row) => {
          const probe: ProbeResult = await probeStream(row.streamUrl).catch(() => unreachable("check_failed"));
          await ctx.runMutation(internal.freightFateStations.recordStationCheck, {
            id: row.id,
            ok: probe.ok,
            ...(probe.ok ? { format: probe.format } : {}),
            now: Date.now(),
          });
          // An AM or FM station the FCC lookup missed, or that was accepted
          // while the query was down, is asked about again here.
          if (row.needsPlacement) {
            await ctx.runAction(internal.freightFateStationPlacement.placeStation, { id: row.id });
          }
        }),
      );
    }
    return { checked: rows.length };
  },
});

// -- the daily station digest -------------------------------------------------------------

const RESEND_SEND_URL = "https://api.resend.com/emails";

// Where the review page lives. Production's site unless this deployment says
// otherwise, e.g. a staging deployment pointing at its preview.
const SITE_URL = "https://www.orinks.net";

export const sendStationDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: boolean; reason?: string; stations?: number }> => {
    const rows: StationDigestRow[] = await ctx.runQuery(internal.freightFateStations.listStationDigest, {});
    if (rows.length === 0) return { sent: false, reason: "nothing_new" };
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.CONTACT_FROM_EMAIL;
    const to = process.env.CONTACT_TO_EMAIL;
    if (!apiKey || !from || !to) {
      console.warn("Freight Fate station digest not sent: email is not configured.");
      return { sent: false, reason: "not_configured" };
    }
    const now = Date.now();
    const token = await signStationBatch({ issuedAt: now, expiresAt: now + STATION_LINK_TTL_MS });
    if (!token) {
      console.warn("Freight Fate station digest not sent: the review secret is not configured.");
      return { sent: false, reason: "not_configured" };
    }
    const site = (process.env.FREIGHT_FATE_SITE_URL || SITE_URL).replace(/\/+$/, "");
    const link = `${site}/freight-fate/review-stations?t=${encodeURIComponent(token)}`;
    const fresh = rows.filter((row) => row.isNew).length;
    const count = `${rows.length} radio station suggestion${rows.length === 1 ? " is" : "s are"} waiting for review` +
      (fresh === rows.length ? "." : `, ${fresh} new since the last digest.`);
    const expiry = "The link expires in 14 days; the next digest carries a fresh one.";
    const subject = `Freight Fate: ${rows.length} station suggestion${rows.length === 1 ? "" : "s"} waiting for review`;
    const text = [count, `Review them: ${link}`, expiry];
    const html = [
      `<p>${escapeHtml(count)}</p>`,
      `<p><a href="${escapeHtml(link)}">Review ${rows.length} station${rows.length === 1 ? "" : "s"}</a></p>`,
      `<p>${escapeHtml(expiry)}</p>`,
    ];
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: text.join("\n\n"),
        html: html.join(""),
      }),
    });
    if (!response.ok) {
      console.warn(`Freight Fate station digest failed: Resend answered ${response.status}.`);
      return { sent: false, reason: `resend_${response.status}` };
    }
    await ctx.runMutation(internal.freightFateStations.markStationDigestSent, {
      ids: rows.map((row) => row.id),
      now,
    });
    return { sent: true, stations: rows.length };
  },
});
