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
  callSignBase,
  isPublicAddress,
  judgeProbe,
  normalizeStreamUrl,
  refuse,
  validateSuggestion,
  type Refusal,
  type StationSuggestionInput,
} from "./freightFateStationRules";
import { STATION_LINK_TTL_MS, signStationClaim, stationFacts, type StationDigestRow } from "./freightFateStations";
import { escapeHtml } from "./freightFateReview";

const PROBE_TIMEOUT_MS = 8_000;
// The whole probe, redirects and one playlist hop included. The game waits on
// this answer with the player listening, and the site route has a minute.
const PROBE_BUDGET_MS = 20_000;
const PROBE_MAX_BYTES = 16 * 1024;
// Enough bytes to be audio rather than an error page that sniffed lucky.
const PROBE_MIN_AUDIO_BYTES = 512;
const MAX_REDIRECTS = 5;
const PROBE_USER_AGENT = "FreightFate-StationCheck/1 (+https://orinks.net/freight-fate)";

export type ProbeResult =
  | { ok: true; format: string }
  | { ok: false; reason: "stream_address_blocked" | "stream_unreachable" | "stream_web_page" | "stream_not_audio" };

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
function rawGet(url: URL, address: string, timeoutMs: number): Promise<RawReply | null> {
  return new Promise((resolve) => {
    const secure = url.protocol === "https:";
    const port = Number(url.port) || (secure ? 443 : 80);
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const socket: Socket = secure
      ? tlsConnect({ host: address, port, servername: isIP(host) ? undefined : host })
      : new Socket().connect(port, address);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(parseReply(Buffer.concat(chunks)));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.once(secure ? "secureConnect" : "connect", () => {
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
  return {
    status: Number(status[1]),
    headers,
    body: new Uint8Array(raw.subarray(headEnd + (split === -1 ? 2 : 4))),
  };
}

/** Follow the address to a stream and say what it plays, or why it does not. */
export function probeStream(address: string) {
  return probeWith(address, publicAddressFor, 0, Date.now() + PROBE_BUDGET_MS);
}

type Resolver = (hostname: string) => Promise<{ blocked: boolean; address: string | null }>;

/** probeStream with the address check supplied: tests point it at a local server. */
export async function probeWith(
  address: string,
  resolve: Resolver,
  depth: number,
  deadline: number,
): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, reason: "stream_unreachable" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "stream_unreachable" };
    const target = await resolve(url.hostname);
    if (target.blocked) return { ok: false, reason: "stream_address_blocked" };
    const remaining = Math.min(PROBE_TIMEOUT_MS, deadline - Date.now());
    if (!target.address || remaining <= 0) return { ok: false, reason: "stream_unreachable" };
    const reply = await rawGet(url, target.address, remaining);
    if (!reply) return { ok: false, reason: "stream_unreachable" };
    const location = reply.headers.get("location");
    if (reply.status >= 300 && reply.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, reason: "stream_unreachable" };
      }
      continue;
    }
    if (reply.status !== 200) return { ok: false, reason: "stream_unreachable" };
    const verdict = judgeProbe(reply.headers.get("content-type") ?? "", reply.body);
    switch (verdict.verdict) {
      case "audio":
        return reply.body.length >= PROBE_MIN_AUDIO_BYTES
          ? { ok: true, format: verdict.format }
          : { ok: false, reason: "stream_unreachable" };
      case "hls":
        return { ok: true, format: "hls" };
      case "playlist":
        // The game resolves a playlist at play time; one level is all a
        // station's playlist ever needs, and it must lead to real audio.
        if (!verdict.next || depth > 0) return { ok: false, reason: "stream_not_audio" };
        return probeWith(verdict.next, resolve, depth + 1, deadline);
      case "web_page":
        return { ok: false, reason: "stream_web_page" };
      default:
        return { ok: false, reason: "stream_not_audio" };
    }
  }
  return { ok: false, reason: "stream_unreachable" };
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

type SuggestResult = { ok: true; message: string } | Refusal;

async function vetAndRecord(
  ctx: ActionCtx,
  who: { driverId?: string; driverTokenHash?: string; authSubject?: string },
  input: StationSuggestionInput,
  clientVersion: string | undefined,
): Promise<SuggestResult> {
  const checked = validateSuggestion(input);
  if (!checked.ok) return checked;
  const suggestion = checked.value;
  const now = Date.now();
  const admitted: { ok: true; driverId: string } | Refusal = await ctx.runMutation(
    internal.freightFateStations.admitSuggestion,
    { ...who, streamKey: suggestion.streamKey, callSignBase: suggestion.callSignBase, now },
  );
  if (!admitted.ok) return admitted;

  const catalog = await shippedCatalog();
  if (
    catalog &&
    (catalog.streams.has(suggestion.streamKey) ||
      (suggestion.callSignBase !== undefined && catalog.callSigns.has(suggestion.callSignBase)))
  ) {
    return refuse("duplicate_catalog");
  }
  const probe = await probeStream(suggestion.streamUrl);
  if (!probe.ok) return refuse(probe.reason);

  const recorded: { ok: true } | Refusal = await ctx.runMutation(
    internal.freightFateStations.recordSuggestion,
    {
      ...suggestion,
      driverId: admitted.driverId,
      streamFormat: probe.format,
      catalogChecked: catalog !== null,
      ...(clientVersion ? { clientVersion } : {}),
      now,
    },
  );
  return recorded.ok ? { ok: true, message: SUGGESTION_RECEIVED } : recorded;
}

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
          const probe = await probeStream(row.streamUrl).catch(() => ({ ok: false as const }));
          await ctx.runMutation(internal.freightFateStations.recordStationCheck, {
            id: row.id,
            ok: probe.ok,
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

export const sendStationDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: boolean; reason?: string; stations?: number }> => {
    const rows: StationDigestRow[] = await ctx.runQuery(internal.freightFateStations.listStationDigest, {});
    if (rows.length === 0) return { sent: false, reason: "nothing_new" };
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.CONTACT_FROM_EMAIL;
    const to = process.env.CONTACT_TO_EMAIL;
    const site = process.env.CONVEX_SITE_URL;
    if (!apiKey || !from || !to || !site) {
      console.warn("Freight Fate station digest not sent: email or site URL is not configured.");
      return { sent: false, reason: "not_configured" };
    }
    const now = Date.now();
    const expiresAt = now + STATION_LINK_TTL_MS;
    const text: string[] = [];
    const html: string[] = [];
    for (const row of rows) {
      const link = async (decision: "accepted" | "declined") => {
        const token = await signStationClaim({ id: row.id, decision, createdAt: row.createdAt, expiresAt });
        return token ? `${site}/freight-fate/station-review?t=${encodeURIComponent(token)}` : null;
      };
      const accept = await link("accepted");
      const decline = await link("declined");
      if (!accept || !decline) {
        console.warn("Freight Fate station digest not sent: the review secret is not configured.");
        return { sent: false, reason: "not_configured" };
      }
      const facts = stationFacts(row);
      const title = `${row.name}${row.isNew ? ", new since the last digest" : ""}`;
      text.push([title, ...facts.map(([term, value]) => `${term}: ${value}`), `Accept: ${accept}`, `Decline: ${decline}`].join("\n"));
      html.push(
        `<h2>${escapeHtml(row.name)}</h2>` +
          (row.isNew ? "<p>New since the last digest.</p>" : "") +
          "<ul>" +
          facts.map(([term, value]) => `<li>${escapeHtml(term)}: ${escapeHtml(value)}</li>`).join("") +
          "</ul>" +
          `<p><a href="${escapeHtml(accept)}">Accept ${escapeHtml(row.name)}</a></p>` +
          `<p><a href="${escapeHtml(decline)}">Decline ${escapeHtml(row.name)}</a></p>`,
      );
    }
    const intro =
      `${rows.length} radio station suggestion${rows.length === 1 ? " is" : "s are"} waiting for review. ` +
      "Each stream answered with playable audio and matched nothing already on the dial. " +
      "Accept puts it on the dial at players' next launch; Decline keeps it off for good. " +
      "Links open a confirmation page and expire in 14 days; the next digest carries fresh ones.";
    const subject = `Freight Fate: ${rows.length} station suggestion${rows.length === 1 ? "" : "s"} waiting for review`;
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: [intro, ...text].join("\n\n"),
        html: `<p>${escapeHtml(intro)}</p>${html.join("")}`,
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
