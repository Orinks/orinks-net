// The rules for a player's radio station suggestion: what the form accepts,
// what counts as "the same stream", what a probe's first bytes say about a
// stream, and which addresses the server will never fetch. Pure functions
// with no Convex or node: imports, so the Convex functions, the site form and
// the tests all read the same rules.
//
// Every refusal carries a reason code and the sentence the player hears. The
// game speaks `message` as it comes, so it is written for a screen reader
// user at the wheel: plain words, no field names, no status codes.

export type StationKind = "terrestrial" | "web";

export type StationSuggestionInput = {
  kind?: unknown;
  name?: unknown;
  streamUrl?: unknown;
  callSign?: unknown;
  frequency?: unknown;
  city?: unknown;
  state?: unknown;
  genre?: unknown;
  note?: unknown;
};

export type StationSuggestion = {
  kind: StationKind;
  name: string;
  streamUrl: string;
  streamKey: string;
  callSign?: string;
  callSignBase?: string;
  frequency?: string;
  frequencyMhz?: number;
  city?: string;
  state?: string;
  genre?: string;
  note?: string;
};

export type Refusal = { ok: false; reason: string; message: string };

export const MAX_STREAM_URL_LENGTH = 500;
export const MAX_NAME_LENGTH = 60;
export const MAX_GENRE_LENGTH = 40;
export const MAX_CITY_LENGTH = 60;
export const MAX_NOTE_LENGTH = 280;

// How many suggestions one driver may send in a day. A real player suggests
// a station now and then; anything past this is a script, and every one
// still lands in the owner's inbox.
export const DAILY_SUGGESTION_LIMIT = 5;
// Suggestions from visitors who are not signed in, all of them together. They
// pass a human check first; this keeps a determined one from filling the
// owner's review email.
export const ANONYMOUS_DAILY_LIMIT = 20;
/** The driverId a suggestion from someone not signed in is stored under. */
export const ANONYMOUS_SUGGESTER = "not-signed-in";

export const REFUSALS = {
  invalid_kind: "Choose whether the station broadcasts on AM or FM, or plays only online.",
  invalid_name: "Give the station's name.",
  name_too_long: "The station name can be up to 60 characters.",
  genre_too_long: "The format can be up to 40 characters.",
  city_too_long: "The city can be up to 60 characters.",
  note_too_long: "The note can be up to 280 characters.",
  invalid_stream_url: "The stream address should start with http or https.",
  invalid_call_sign: "A broadcast station needs its call sign, like WXYZ or KABC-FM.",
  invalid_frequency: "The frequency should be a number on the AM or FM dial, like 101.5 or 1090.",
  invalid_state: "A broadcast station needs the state it broadcasts from.",
  stream_address_blocked: "That stream address can't be checked from here.",
  stream_unreachable: "That stream didn't answer. Check the address and try again.",
  stream_web_page: "That address is a web page, not a stream. Look for the station's direct stream link.",
  stream_not_audio: "That address answered, but not with audio the radio can play.",
  stream_station_list: "That address is a list of several stations. Suggest each station with its own stream address.",
  station_list_used_up: "This playlist can't be sent today; your 5 suggestions are used up. Try again tomorrow.",
  station_list_used_up_anonymous:
    "This playlist can't be sent today; suggestions from visitors are used up. Signing in with a driver gives you 5 of your own.",
  no_station_name: "No station name found.",
  duplicate_catalog: "That station is already on the dial.",
  duplicate_suggestion: "That station has already been suggested.",
  already_declined: "That station was already suggested and turned down.",
  daily_limit: "That's all the suggestions for today. Try again tomorrow.",
  anonymous_limit: "That's all the suggestions without signing in for today. Sign in, or try again tomorrow.",
  human_check: "Confirm you are human using the checkbox, then send again.",
  rate_limited: "One moment, then try again.",
  unauthorized: "Your driver isn't signed in on this computer.",
  driver_not_found: "Your driver isn't signed in on this computer.",
  not_configured: "Station suggestions aren't available right now.",
} as const;

export type RefusalReason = keyof typeof REFUSALS;

export function refuse(reason: RefusalReason): Refusal {
  return { ok: false, reason, message: REFUSALS[reason] };
}

export const SUGGESTION_RECEIVED =
  "Thanks. The stream checked out, and your suggestion is waiting for review.";

// Said when the check could not reach the stream. A stream that plays for the
// player can still refuse the check's server (a dropped connection, a host
// that turns away data centres), so the suggestion goes to review anyway.
export const SUGGESTION_RECEIVED_UNHEARD =
  "Thanks. We couldn't reach the stream from here, so it will be checked by hand during review.";

// -- stream identity ----------------------------------------------------------

// Ported from normalize_stream_url in the game's ff-core radio.rs, so the
// server and the game agree on what counts as the same stream: scheme and a
// trailing slash or semicolon dropped, the host folded to lower case, and a
// Live365 mount folded onto its station id.
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LIVE365_HOST =
  /^(?:streaming\.live365\.com|(?:ais|das)-[\w.-]*\.cdnstream1?\.com|[\w-]+\.peta\.live365\.net)$/i;
const LIVE365_MOUNT = /^([ab]\d{4,7})(?:_[0-9a-z]+)?$/i;

export function normalizeStreamUrl(url: string) {
  let rest = url.trim().replace(URL_SCHEME, "");
  rest = rest.replace(/[/;]+$/, "");
  const slash = rest.indexOf("/");
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  if (LIVE365_HOST.test(host)) {
    const mount = path.split("?")[0];
    const match = LIVE365_MOUNT.exec(mount);
    if (match) return `streaming.live365.com/${match[1].toLowerCase()}`;
  }
  return path ? `${host}/${path}` : host;
}

// Ported from call_sign_base: WNYC-FM, "WNYC FM" and WNYC are one station.
export function callSignBase(callSign: string) {
  return callSign.replace(/-/g, " ").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

// -- the form -------------------------------------------------------------------

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "OH" reads as Ohio; an unknown code comes back as it was given. */
export function stateName(code: string) {
  return STATES[code] ?? code;
}

export const STATE_OPTIONS = Object.entries(STATES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** "OH", "oh", "Ohio" and " ohio " all read as OH; anything else is null. */
export function normalizeState(value: string) {
  const text = value.trim().replace(/\.$/, "").replace(/\s+/g, " ");
  const upper = text.toUpperCase();
  if (STATES[upper]) return upper;
  const byName = Object.entries(STATES).find(([, name]) => name.toUpperCase() === upper);
  return byName ? byName[0] : null;
}

/** "WXYZ", "wxyz fm" and "KABC-FM" read as WXYZ, WXYZ-FM and KABC-FM. */
export function normalizeCallSign(value: string) {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, "-");
  const match = /^([KWC][A-Z]{2,3})(?:-(FM|AM|LP|LPFM|HD[1-9]))?$/.exec(compact);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

/** "101.5", "101.5 FM", "1090 AM" read as the dial position and band. */
export function normalizeFrequency(value: string) {
  const match = /^(\d{2,4}(?:\.\d)?)\s*(?:(fm|am|mhz|khz))?$/i.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const fm = unit === "fm" || unit === "mhz" || (unit === undefined && number < 200);
  if (fm && number >= 87.5 && number <= 108) {
    return { text: `${number.toFixed(1)} FM`, frequencyMhz: number };
  }
  if (!fm && number >= 530 && number <= 1710 && Number.isInteger(number)) {
    return { text: `${number} AM` };
  }
  return null;
}

// Never truncates: a long note cut short with no word about it is silent data
// loss. Callers refuse text over the limit instead (see tooLong).
function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeStreamAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_STREAM_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  url.hash = "";
  return url.toString();
}

/** The form as the player sent it, checked field by field. */
export function validateSuggestion(
  input: StationSuggestionInput,
): { ok: true; value: StationSuggestion } | Refusal {
  const kind = input.kind === "terrestrial" || input.kind === "web" ? input.kind : null;
  if (!kind) return refuse("invalid_kind");
  const name = cleanText(input.name);
  if (name.length < 2) return refuse("invalid_name");
  if (name.length > MAX_NAME_LENGTH) return refuse("name_too_long");
  const streamUrl = normalizeStreamAddress(input.streamUrl);
  if (!streamUrl) return refuse("invalid_stream_url");
  const value: StationSuggestion = {
    kind,
    name,
    streamUrl,
    streamKey: normalizeStreamUrl(streamUrl),
  };
  const genre = cleanText(input.genre);
  if (genre.length > MAX_GENRE_LENGTH) return refuse("genre_too_long");
  if (genre) value.genre = genre;
  const note = cleanText(input.note);
  if (note.length > MAX_NOTE_LENGTH) return refuse("note_too_long");
  if (note) value.note = note;
  if (kind === "web") return { ok: true, value };

  const callSign = normalizeCallSign(cleanText(input.callSign).slice(0, 16));
  if (!callSign) return refuse("invalid_call_sign");
  value.callSign = callSign;
  value.callSignBase = callSignBase(callSign);
  const state = normalizeState(cleanText(input.state).slice(0, 32));
  if (!state) return refuse("invalid_state");
  value.state = state;
  const frequencyText = cleanText(input.frequency).slice(0, 16);
  if (frequencyText) {
    const frequency = normalizeFrequency(frequencyText);
    if (!frequency) return refuse("invalid_frequency");
    value.frequency = frequency.text;
    if (frequency.frequencyMhz !== undefined) value.frequencyMhz = frequency.frequencyMhz;
  }
  const city = cleanText(input.city);
  if (city.length > MAX_CITY_LENGTH) return refuse("city_too_long");
  if (city) value.city = city;
  return { ok: true, value };
}

// -- what a probe heard -----------------------------------------------------------

export type ProbeVerdict =
  | { verdict: "audio"; format: string }
  | { verdict: "hls" }
  | { verdict: "playlist"; next: string | null }
  | { verdict: "station_list"; stations: ListedStation[] }
  | { verdict: "web_page" }
  | { verdict: "not_audio" };

const CONTENT_TYPE_FORMATS: Array<[RegExp, string]> = [
  [/^audio\/(mpeg|mp3|mpeg3|x-mpeg)$/, "mp3"],
  [/^audio\/(aacp|x-aacp)$/, "aac+"],
  [/^audio\/(aac|x-aac|mp4|x-m4a)$/, "aac"],
  [/^(audio|application)\/(ogg|opus|x-ogg)$/, "ogg"],
  [/^audio\/(flac|x-flac)$/, "flac"],
];

function sniffBytes(bytes: Uint8Array) {
  const head = (n: number) => String.fromCharCode(...bytes.slice(0, n));
  if (head(4) === "OggS") return "ogg";
  if (head(4) === "fLaC") return "flac";
  if (head(3) === "ID3") return "mp3";
  // Frame sync: eleven set bits. The layer bits tell MPEG audio from ADTS AAC.
  for (let i = 0; i + 1 < Math.min(bytes.length, 4096); i += 1) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      return (bytes[i + 1] & 0x06) === 0 ? "aac" : "mp3";
    }
  }
  return null;
}

/**
 * The content types the site's preview passes through: audio, the containers
 * HLS carries it in, an octet stream, or no type at all (some Shoutcast
 * servers send none). The check holds an HLS segment to the same list, so a
 * stream it says plays is one the preview can play.
 */
export function previewPlayable(contentType: string) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "" || /^(audio\/|video\/|application\/(ogg|mp4|octet-stream)$|binary\/octet-stream$)/.test(type);
}

/**
 * The body of a chunked HTTP reply, as far as it arrived. Some servers chunk
 * even an HTTP/1.0 request's reply, and the size lines would otherwise sit
 * in front of the "#EXTM3U" a playlist is known by.
 */
export function dechunk(body: Uint8Array) {
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const parts: Buffer[] = [];
  let at = 0;
  while (at < bytes.length) {
    const lineEnd = bytes.indexOf("\r\n", at);
    if (lineEnd === -1) break;
    const size = parseInt(bytes.subarray(at, lineEnd).toString("latin1").split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = lineEnd + 2;
    parts.push(bytes.subarray(start, Math.min(start + size, bytes.length)));
    at = start + size + 2;
  }
  return new Uint8Array(Buffer.concat(parts));
}

/** One station a playlist of several names, as the picker offers it. */
export type ListedStation = { name: string; streamUrl: string };

// The most stations a picker lists from one playlist. More than a day's
// allowance either way; a huge directory is cut here.
export const MAX_LISTED_STATIONS = 50;

/** Each stream a playlist names, with the title it gives it, in order. */
function playlistEntries(text: string) {
  const entries: Array<{ url: string; title: string }> = [];
  const plsTitles = new Map<string, string>();
  let extinf = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const title = /^Title(\d+)=(.*)$/i.exec(line);
    if (title) plsTitles.set(title[1], title[2].trim());
    if (/^#EXTINF:/i.test(line)) extinf = line.replace(/^#EXTINF:[^,]*,?/i, "").trim();
    const file = /^File(\d+)=(.*)$/i.exec(line);
    const url = file ? file[2].trim() : line;
    if (/^https?:\/\//i.test(url)) {
      entries.push({ url, title: file ? `pls:${file[1]}` : extinf });
      extinf = "";
    }
  }
  return entries.map((entry) =>
    entry.title.startsWith("pls:") ? { ...entry, title: plsTitles.get(entry.title.slice(4)) ?? "" } : entry,
  );
}

/**
 * Whether a playlist names more than one station. A station's own playlist
 * often lists several servers carrying one mount, so entries count as one
 * station when they share a path, or when every entry carries the same title.
 * The game only ever plays the first entry, so the rest of a list of stations
 * would never be heard.
 */
function namesSeveralStations(entries: Array<{ url: string; title: string }>) {
  if (entries.length < 2) return false;
  const titles = new Set(entries.map((entry) => entry.title.toLowerCase()));
  if (titles.size === 1 && !titles.has("")) return false;
  const paths = new Set(
    entries.map((entry) => {
      try {
        const url = new URL(entry.url);
        return `${url.pathname.replace(/[/;]+$/, "").toLowerCase()}${url.search}`;
      } catch {
        return entry.url;
      }
    }),
  );
  return paths.size > 1;
}

/** What the first bytes of a reply say it is. */
export function judgeProbe(contentType: string, bytes: Uint8Array): ProbeVerdict {
  const type = contentType.split(";")[0].trim().toLowerCase();
  // The probe stops at 16 KB, which holds a playlist of a hundred stations.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const trimmed = text.trimStart();
  if (/^#EXTM3U/.test(trimmed) && /#EXT-X-/.test(text)) return { verdict: "hls" };
  if (
    /mpegurl|x-scpls|pls\+xml/.test(type) ||
    /^#EXTM3U/.test(trimmed) ||
    /^\[playlist\]/i.test(trimmed)
  ) {
    const entries = playlistEntries(text);
    if (namesSeveralStations(entries)) {
      return {
        verdict: "station_list",
        stations: entries.slice(0, MAX_LISTED_STATIONS).map((entry) => ({
          name: entry.title.slice(0, MAX_NAME_LENGTH),
          streamUrl: entry.url,
        })),
      };
    }
    return { verdict: "playlist", next: entries[0]?.url ?? null };
  }
  if (type === "text/html" || /^<!doctype html|^<html/i.test(trimmed)) return { verdict: "web_page" };
  for (const [pattern, format] of CONTENT_TYPE_FORMATS) {
    if (pattern.test(type)) return { verdict: "audio", format };
  }
  const sniffed = sniffBytes(bytes);
  if (sniffed && (type === "" || type === "application/octet-stream" || type.startsWith("audio/"))) {
    return { verdict: "audio", format: sniffed };
  }
  return { verdict: "not_audio" };
}

// -- addresses the server never fetches ----------------------------------------------

function ipv4Parts(address: string) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

/** False for loopback, private, link-local, shared, multicast and reserved space. */
export function isPublicAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const v4 = ipv4Parts(mapped ? mapped[1] : address);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = address.toLowerCase();
  if (!v6.includes(":")) return false;
  if (v6 === "::" || v6 === "::1") return false;
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6)) return false;
  if (v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8:")) return false;
  return true;
}
