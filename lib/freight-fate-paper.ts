// The Freight Fate driver newspaper: the rules both the backend jobs
// (convex/freightFatePaper.ts) and the page share. Nothing here imports the
// backend, so the page, the game's reader and the tests can all use it.
//
// Design: /freight-fate/news, "The driver newspaper: design", 2026-11-22.
//
// An edition stores stories as data: a kind, the driver ids it is about, the
// facts (numbers and catalog keys) and which wording to use. Text is produced
// when the edition is read, from the driver rows as they are then, so a driver
// who turns Profile sharing off leaves old editions too.
//
// DRIVER NAME MARKER. Rendered headlines and bodies never contain a display
// name. Where a story names a driver, the text holds `{@<driverId>}`, and the
// rendered story's `drivers` list maps each id to the name to show. Driver ids
// are lowercase letters, digits, `-` and `_`, and every other brace slot has
// been filled by then, so `{@` can only begin a marker. `paperTextSegments`
// splits a text into plain runs and drivers (the page links each driver to
// their profile, with the name as the link text); `paperTextPlain` swaps the
// markers for the names, for a feed or for speech.
import phrasesData from "../data/freight-fate-paper-phrases.json";
import backPageData from "../data/freight-fate-paper-back-page.json";
import { ALL_LINES, CAREER_TWO_INVARIANTS, STABLE_INVARIANTS } from "./freight-fate-invariants";

// --- The switch ---

export type PaperMode = "off" | "preview" | "on";

/** FREIGHT_FATE_PAPER: unset or anything unknown is off. */
export function paperMode(raw: string | undefined): PaperMode {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "on" || value === "preview" ? value : "off";
}

// --- Edition state ---

export type EditionState = "building" | "preview" | "published" | "pulled";
export type EditionEvent = "finish_preview" | "finish_public" | "publish" | "pull";

const EDITION_TRANSITIONS: Record<EditionState, Partial<Record<EditionEvent, EditionState>>> = {
  building: { finish_preview: "preview", finish_public: "published" },
  preview: { publish: "published", pull: "pulled" },
  published: { pull: "pulled" },
  pulled: { publish: "published" },
};

/** The one place an edition's state moves. Anything not in the table throws. */
export function nextEditionState(state: EditionState, event: EditionEvent): EditionState {
  const next = EDITION_TRANSITIONS[state]?.[event];
  if (!next) throw new Error(`Paper edition cannot ${event} from ${state}`);
  return next;
}

/** Which editions a reader may see in each mode. */
export function editionReadable(state: EditionState, mode: PaperMode, admin: boolean) {
  if (mode === "off") return false;
  if (state === "published") return mode === "on" || admin;
  return state === "preview" && admin;
}

// --- Eastern time ---
//
// The paper's week runs Monday to Monday at midnight Eastern. US daylight
// time starts the second Sunday in March at 2:00 local and ends the first
// Sunday in November at 2:00 local; computed here rather than through Intl so
// the backend's clock arithmetic does not depend on its time zone data.

const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function nthSundayUtc(year: number, month: number, n: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return Date.UTC(year, month, 1 + ((7 - first) % 7) + (n - 1) * 7);
}

/** Eastern offset from UTC in ms at this instant: -4 h in daylight time, else -5 h. */
export function easternOffsetMs(utcMs: number) {
  const year = new Date(utcMs).getUTCFullYear();
  const start = nthSundayUtc(year, 2, 2) + 7 * HOUR_MS; // 2:00 EST
  const end = nthSundayUtc(year, 10, 1) + 6 * HOUR_MS; // 2:00 EDT
  return utcMs >= start && utcMs < end ? -4 * HOUR_MS : -5 * HOUR_MS;
}

/** YYYY-MM-DD of this instant on an Eastern calendar. */
export function easternDateKey(utcMs: number) {
  return new Date(utcMs + easternOffsetMs(utcMs)).toISOString().slice(0, 10);
}

/** 0 Sunday ... 6 Saturday, Eastern. */
export function easternWeekday(utcMs: number) {
  return new Date(utcMs + easternOffsetMs(utcMs)).getUTCDay();
}

/** The instant the Eastern week holding utcMs began: Monday 00:00 Eastern. */
export function weekStartMs(utcMs: number) {
  const local = utcMs + easternOffsetMs(utcMs);
  const day = new Date(local).getUTCDay();
  const localMidnight = Math.floor(local / DAY_MS) * DAY_MS - ((day + 6) % 7) * DAY_MS;
  // Daylight time changes at 2:00 local on a Sunday, never at midnight, so
  // the offset five hours after local midnight is the offset at midnight.
  return localMidnight - easternOffsetMs(localMidnight + 5 * HOUR_MS);
}

/** The next week's start, across a daylight time change. */
export function nextWeekStartMs(weekStart: number) {
  return weekStartMs(weekStart + WEEK_MS + 12 * HOUR_MS);
}

/** The week's Monday as YYYY-MM-DD, Eastern. */
export function weekKeyOf(utcMs: number) {
  return easternDateKey(weekStartMs(utcMs));
}

// --- Thresholds ---

export const MILE_MARKS = [100_000, 250_000, 500_000, 1_000_000] as const;
export const DELIVERY_MARKS = [100, 500, 1_000] as const;
export const STATE_MARKS = [10, 25, 48] as const;
export const BEST_ON_TIME_MIN_LOADS = 5;
export const LANE_MIN_LOADS = 3;
export const MIN_NAMED_STORIES = 3;
// Single-load caps: a delivery past either is left out of every record and
// total, as publicDriverEvent already does for miles.
export const MAX_EVENT_MILES = 10_000;
export const MAX_EVENT_POUNDS = 200_000;
// An achievement is rare when fewer than one nameable driver in this many
// holds it.
export const RARE_ACHIEVEMENT_ONE_IN = 20;

/** The highest mark the value passed this week, if any. */
export function crossedMark(before: number, after: number, marks: readonly number[]) {
  return [...marks].reverse().find((mark) => before < mark && after >= mark);
}

// --- Catalog ---
//
// Stories hold catalog keys, never text a player or the game typed. The game
// sends cargo and cities as spoken text in a version 1 delivery; each is
// matched exactly against the catalog labels here, and a miss is simply a fact
// the story does not have.

type Labels = Record<string, string>;

function optionalLabels(name: "cargoLabels" | "weatherLabels"): Labels {
  const read = (row: unknown) => {
    const value = (row as Record<string, unknown>)[name];
    return value && typeof value === "object" ? value as Labels : {};
  };
  return { ...read(CAREER_TWO_INVARIANTS), ...read(STABLE_INVARIANTS) };
}

function optionalList(name: string): string[] {
  const read = (row: unknown) => {
    const value = (row as Record<string, unknown>)[name];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return [...new Set([...read(STABLE_INVARIANTS), ...read(CAREER_TWO_INVARIANTS)])];
}

/** Cargo names, once the catalog export carries `cargoLabels` (task N4). */
export const CARGO_LABELS: Labels = optionalLabels("cargoLabels");
/** Every cargo key the game can send in a version 2 delivery. */
export const CARGO_KEYS = new Set([...optionalList("marketCargoKeys"), ...Object.keys(CARGO_LABELS)]);
/** Weather keys, once the export carries `weatherKeys` (task N4). Empty means unchecked. */
export const WEATHER_KEYS = new Set(optionalList("weatherKeys"));

function invert(labels: Labels) {
  const out = new Map<string, string>();
  for (const [key, label] of Object.entries(labels)) {
    if (!out.has(label)) out.set(label, key);
  }
  return out;
}

const CITY_BY_LABEL = invert(ALL_LINES.cityLabels);
const CITY_BY_NAME = (() => {
  const counts = new Map<string, string[]>();
  for (const [key, label] of Object.entries(ALL_LINES.cityLabels)) {
    const comma = label.lastIndexOf(", ");
    const name = comma < 0 ? label : label.slice(0, comma);
    counts.set(name, [...(counts.get(name) ?? []), key]);
  }
  const out = new Map<string, string>();
  for (const [name, keys] of counts) if (keys.length === 1) out.set(name, keys[0]);
  return out;
})();
const CARGO_BY_LABEL = invert(CARGO_LABELS);
const CARRIER_BY_LABEL = invert(ALL_LINES.carrierLabels);
const TRUCK_BY_LABEL = invert(ALL_LINES.truckLabels);
const ENDORSEMENT_LABELS: Labels = (() => {
  const out: Labels = {};
  for (const line of [CAREER_TWO_INVARIANTS, STABLE_INVARIANTS]) {
    for (const [key, def] of Object.entries(line.endorsements as Record<string, { label: string }>)) {
      out[key] = def.label;
    }
  }
  return out;
})();
const ENDORSEMENT_BY_LABEL = invert(ENDORSEMENT_LABELS);
const CAREER_TITLES = new Set<string>([
  ...STABLE_INVARIANTS.careerTitles, ...STABLE_INVARIANTS.companyCareerTitles,
  ...CAREER_TWO_INVARIANTS.careerTitles, ...CAREER_TWO_INVARIANTS.companyCareerTitles,
]);

/** A city key for "City, State", or for a city name the catalog has once. */
export function cityKeyFromText(text: unknown) {
  if (typeof text !== "string") return undefined;
  const value = text.trim();
  return CITY_BY_LABEL.get(value) ?? CITY_BY_NAME.get(value);
}

export function cityKeyFromPlace(city: string, state: string) {
  return CITY_BY_LABEL.get(`${city}, ${state}`);
}

export function cargoKeyFromText(text: unknown) {
  return typeof text === "string" ? CARGO_BY_LABEL.get(text.trim()) : undefined;
}

export function carrierKeyFromLabel(label: string | undefined) {
  return label === undefined ? undefined : CARRIER_BY_LABEL.get(label);
}

export function truckKeyFromLabel(label: string | undefined) {
  return label === undefined ? undefined : TRUCK_BY_LABEL.get(label);
}

export function endorsementKeyFromLabel(label: string) {
  return ENDORSEMENT_BY_LABEL.get(label);
}

/** A career title the game's ladders hold, or "Level N driver". */
export function knownCareerTitle(title: string | undefined) {
  if (title === undefined) return false;
  return CAREER_TITLES.has(title) || /^Level \d{1,3} driver$/.test(title);
}

export function isCityKey(key: unknown): key is string {
  return typeof key === "string" && Object.hasOwn(ALL_LINES.cityLabels, key);
}

export function isAchievementKey(key: unknown): key is string {
  return typeof key === "string" && Object.hasOwn(ALL_LINES.achievementLabels, key);
}

export const WEATHER_KEY = /^[a-z_]{1,24}$/;

function wholeInRange(value: unknown) {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 500);
}

/** Why a version 2 delivery is refused, or null when its keys all check out. */
export function deliveryV2Problem(payload: {
  cargoKey: string; originKey: string; destinationKey: string;
  conditions?: { weather?: string[]; workZones?: number; scales?: number; inspections?: number };
}) {
  if (!CARGO_KEYS.has(payload.cargoKey)) return "unknown_cargo";
  if (!isCityKey(payload.originKey) || !isCityKey(payload.destinationKey)) return "unknown_city";
  const conditions = payload.conditions;
  if (conditions) {
    const weather = conditions.weather ?? [];
    if (weather.length > 8 || weather.some((key) => !WEATHER_KEY.test(key)
      || (WEATHER_KEYS.size > 0 && !WEATHER_KEYS.has(key)))) return "unknown_weather";
    if (![conditions.workZones, conditions.scales, conditions.inspections].every(wholeInRange)) {
      return "bad_count";
    }
  }
  return null;
}

// --- Wording ---

export type SlotType =
  | "driver" | "driverList" | "number" | "city" | "cargo" | "carrier" | "truck"
  | "endorsement" | "title" | "achievement" | "text" | "textList";

const n = "number" as const;

/** Every slot the jobs can fill, per story kind. A wording may name no other. */
export const KIND_SLOTS: Record<string, Record<string, SlotType>> = {
  first_delivery: { driver: "driver", cargo: "cargo", origin: "city", destination: "city", miles: n, carrier: "carrier" },
  promotion: { driver: "driver", title: "title", level: n, carrier: "carrier" },
  mile_club: { driver: "driver", mark: n, deliveries: n },
  delivery_club: { driver: "driver", mark: n, rate: n },
  endorsement: { driver: "driver", endorsement: "endorsement" },
  new_truck_owned: { driver: "driver", truck: "truck" },
  new_truck_assigned: { driver: "driver", truck: "truck", carrier: "carrier" },
  leased_on: { driver: "driver", carrier: "carrier" },
  own_authority: { driver: "driver", from_carrier: "carrier" },
  moved_carrier: { driver: "driver", carrier: "carrier", from_carrier: "carrier" },
  states_mark: { driver: "driver", mark: n },
  new_hires: { count: n, drivers: "driverList" },
  record_week_miles: { driver: "driver", miles: n },
  most_miles: { driver: "driver", miles: n, deliveries: n },
  most_deliveries: { driver: "driver", count: n },
  best_on_time: { driver: "driver", count: n },
  longest_haul: { driver: "driver", miles: n, cargo: "cargo", origin: "city", destination: "city" },
  heaviest_load: { driver: "driver", weight: n, cargo: "cargo", origin: "city", destination: "city" },
  most_new_cities: { driver: "driver", count: n },
  first_into_city: { driver: "driver", city: "city", cargo: "cargo", origin: "city", miles: n },
  rare_achievement: { driver: "driver", achievement: "achievement", holders: n },
  week_totals: { drivers: n, loads: n, miles: n },
  busiest_lane: { origin: "city", destination: "city", count: n },
  top_cargo: { cargo: "cargo", count: n },
  tons_total: { tons: n },
  blotter_citations: { count: n },
  blotter_out_of_service: { count: n },
  blotter_crashes: { count: n },
  blotter_cargo_claims: { count: n },
  stations_added: { count: n, stations: "textList" },
  game_release: { version: "text" },
};

type Wording = { headline: string; body: string };
type KindSpec = {
  section: string;
  always: string[];
  variants?: Wording[];
  one?: Wording;
  other?: Wording;
};
export type PaperPhrases = {
  version: number;
  kinds: Record<string, KindSpec>;
  sections: Record<string, string>;
  tables: {
    records: { caption: string; columns: string[]; rows: Record<string, string> };
    carrier_standings: { caption: string; columns: string[] };
  };
};
export type BackPagePiece = { id: string; kind: string; title: string; body: string[] };
export type PaperBackPage = {
  version: number;
  heading: string;
  kinds: Record<string, string>;
  pieces: BackPagePiece[];
};

export function slotsOf(text: string) {
  return [...text.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]);
}

function wordingSlots(wording: Wording) {
  return new Set([...slotsOf(wording.headline), ...slotsOf(wording.body)]);
}

/** Throws on wording the jobs could not fill. Run at build and in the tests. */
export function validatePaperPhrases(raw: unknown): PaperPhrases {
  const data = raw as PaperPhrases;
  const fail = (message: string): never => {
    throw new Error(`freight-fate-paper-phrases.json: ${message}`);
  };
  if (!data || typeof data !== "object" || !data.kinds || !data.sections) fail("needs kinds and sections");
  for (const kind of Object.keys(KIND_SLOTS)) {
    if (!data.kinds[kind]) fail(`has no wording for the kind "${kind}"`);
  }
  for (const [kind, spec] of Object.entries(data.kinds)) {
    const allowed = KIND_SLOTS[kind];
    if (!allowed) fail(`names a kind the paper cannot build: "${kind}"`);
    if (!data.sections[spec.section]) fail(`kind "${kind}" is in an unknown section "${spec.section}"`);
    if (!Array.isArray(spec.always)) fail(`kind "${kind}" needs an always list`);
    for (const slot of spec.always) {
      if (!allowed[slot]) fail(`kind "${kind}" always has "${slot}", which it cannot have`);
    }
    const always = new Set(spec.always);
    const wordings: Wording[] = spec.variants ?? [];
    if (spec.variants && (spec.one || spec.other)) fail(`kind "${kind}" has both variants and one/other`);
    if (!spec.variants) {
      if (!spec.one || !spec.other) fail(`kind "${kind}" needs variants, or both one and other`);
      if (!allowed.count) fail(`kind "${kind}" picks one/other but has no count slot`);
      wordings.push(spec.one!, spec.other!);
    }
    if (wordings.length === 0) fail(`kind "${kind}" has no wording`);
    let plain = false;
    for (const wording of wordings) {
      if (!wording.headline?.trim()) fail(`kind "${kind}" has an empty headline`);
      if (!wording.body?.trim()) fail(`kind "${kind}" has an empty body`);
      const slots = wordingSlots(wording);
      for (const slot of slots) {
        if (!allowed[slot]) fail(`kind "${kind}" names the slot "${slot}", which it cannot have`);
      }
      const needsOnlyAlways = [...slots].every((slot) => always.has(slot));
      if (!spec.variants && !needsOnlyAlways) fail(`kind "${kind}" one/other needs slots beyond always`);
      plain ||= needsOnlyAlways;
    }
    if (!plain) fail(`kind "${kind}" has no wording that needs only its always slots`);
  }
  for (const [table, spec] of Object.entries(data.tables ?? {})) {
    if (!spec.caption?.trim() || !Array.isArray(spec.columns) || spec.columns.length === 0) {
      fail(`table "${table}" needs a caption and columns`);
    }
  }
  return data;
}

export function validatePaperBackPage(raw: unknown): PaperBackPage {
  const data = raw as PaperBackPage;
  const fail = (message: string): never => {
    throw new Error(`freight-fate-paper-back-page.json: ${message}`);
  };
  if (!data || !Array.isArray(data.pieces) || !data.kinds) fail("needs kinds and pieces");
  const seen = new Set<string>();
  for (const piece of data.pieces) {
    if (!piece.id?.trim() || seen.has(piece.id)) fail(`missing or repeated id "${piece.id}"`);
    seen.add(piece.id);
    if (!data.kinds[piece.kind]) fail(`piece "${piece.id}" has an unknown kind "${piece.kind}"`);
    if (!piece.title?.trim()) fail(`piece "${piece.id}" has an empty title`);
    if (!Array.isArray(piece.body) || piece.body.length === 0 || piece.body.some((p) => !p.trim())) {
      fail(`piece "${piece.id}" needs non-empty paragraphs`);
    }
    if ([piece.title, ...piece.body].some((text) => /[{}]/.test(text))) {
      fail(`piece "${piece.id}" contains a brace slot`);
    }
  }
  for (const kind of Object.keys(data.kinds)) {
    if (!data.pieces.some((piece) => piece.kind === kind)) fail(`kind "${kind}" has no pieces`);
  }
  return data;
}

export const PAPER_PHRASES = validatePaperPhrases(phrasesData);
export const PAPER_BACK_PAGE = validatePaperBackPage(backPageData);

/** One back-page piece of each kind: issue number modulo that kind's count, in file order. */
export function backPageFor(issue: number, backPage: PaperBackPage = PAPER_BACK_PAGE) {
  return Object.keys(backPage.kinds).map((kind) => {
    const pieces = backPage.pieces.filter((piece) => piece.kind === kind);
    return pieces[(((issue - 1) % pieces.length) + pieces.length) % pieces.length].id;
  });
}

// --- Stories ---

export type FactValue = number | string | string[];
export type PaperStory = {
  id: string;
  section: string;
  kind: string;
  driverIds: string[];
  facts: Record<string, FactValue>;
  variant: number;
  rank: number;
  pulled?: boolean;
};

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Whether a fact resolves to printable text for its slot type. */
function factResolves(type: SlotType, value: FactValue | undefined) {
  switch (type) {
    case "driver":
    case "driverList":
      return true;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "city":
      return isCityKey(value);
    case "cargo":
      return typeof value === "string" && Object.hasOwn(CARGO_LABELS, value);
    case "carrier":
      return typeof value === "string" && Object.hasOwn(ALL_LINES.carrierLabels, value);
    case "truck":
      return typeof value === "string" && Object.hasOwn(ALL_LINES.truckLabels, value);
    case "endorsement":
      return typeof value === "string" && Object.hasOwn(ENDORSEMENT_LABELS, value);
    case "title":
      return typeof value === "string" && knownCareerTitle(value);
    case "achievement":
      return isAchievementKey(value);
    case "text":
      return typeof value === "string" && value.trim() !== "" && !/[{}]/.test(value);
    case "textList":
      return Array.isArray(value) && value.length > 0 && value.every((item) => !/[{}]/.test(item));
  }
}

function wordingsOf(kind: string, phrases: PaperPhrases) {
  const spec = phrases.kinds[kind];
  return spec.variants ?? [spec.one!, spec.other!];
}

/**
 * The wording a new story uses: chosen once, by a hash of the issue number
 * and the first driver id, among the wordings whose slots the facts can fill.
 */
export function chooseVariant(
  kind: string,
  issue: number,
  driverIds: string[],
  facts: Record<string, FactValue>,
  phrases: PaperPhrases = PAPER_PHRASES,
) {
  const spec = phrases.kinds[kind];
  if (!spec.variants) return 0;
  const slots = KIND_SLOTS[kind];
  const usable = spec.variants
    .map((wording, index) => ({ wording, index }))
    .filter(({ wording }) => [...wordingSlots(wording)].every((slot) => factResolves(slots[slot], facts[slot])));
  if (usable.length === 0) return 0;
  return usable[fnv1a(`${issue}:${driverIds[0] ?? kind}`) % usable.length].index;
}

export function formatPaperNumber(value: number) {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const [whole, fraction] = String(Math.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function joinPaperList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function driverMarker(driverId: string) {
  return `{@${driverId}}`;
}

function slotText(type: SlotType, value: FactValue | undefined, driverIds: string[]) {
  switch (type) {
    case "driver":
      return driverMarker(driverIds[0]);
    case "driverList":
      return joinPaperList(driverIds.map(driverMarker));
    case "number":
      return formatPaperNumber(value as number);
    case "city":
      return ALL_LINES.cityLabels[value as string];
    case "cargo":
      return CARGO_LABELS[value as string];
    case "carrier":
      return ALL_LINES.carrierLabels[value as string];
    case "truck":
      return ALL_LINES.truckLabels[value as string];
    case "endorsement":
      return ENDORSEMENT_LABELS[value as string];
    case "title":
    case "text":
      return value as string;
    case "achievement":
      return ALL_LINES.achievementLabels[value as string];
    case "textList":
      return joinPaperList(value as string[]);
  }
}

export type RenderedStory = {
  id: string;
  section: string;
  kind: string;
  headline: string;
  body: string;
  drivers: Array<{ driverId: string; displayName: string }>;
};

/**
 * One story's text, or null when it cannot be printed: pulled, a driver it
 * names is not nameable now, or a fact it always needs no longer resolves.
 * `names` holds only nameable drivers. A list of drivers (new hires) loses
 * the ones not in it and is recounted.
 */
export function renderPaperStory(
  story: PaperStory,
  names: ReadonlyMap<string, string>,
  phrases: PaperPhrases = PAPER_PHRASES,
): RenderedStory | null {
  const spec = phrases.kinds[story.kind];
  const slots = KIND_SLOTS[story.kind];
  if (story.pulled || !spec || !slots) return null;
  const listed = Object.values(slots).includes("driverList");
  const driverIds = listed
    ? story.driverIds.filter((id) => names.has(id))
    : story.driverIds;
  if (driverIds.length === 0 && story.driverIds.length > 0) return null;
  if (!listed && driverIds.some((id) => !names.has(id))) return null;
  const facts = { ...story.facts };
  if (listed) facts.count = driverIds.length;
  if (spec.always.some((slot) => !factResolves(slots[slot], facts[slot]))) return null;

  const wordings = wordingsOf(story.kind, phrases);
  let wording: Wording;
  if (!spec.variants) {
    wording = facts.count === 1 ? spec.one! : spec.other!;
  } else {
    const fits = (candidate: Wording | undefined) => candidate
      && [...wordingSlots(candidate)].every((slot) => factResolves(slots[slot], facts[slot]));
    const chosen = wordings[story.variant];
    wording = fits(chosen) ? chosen : wordings.find((candidate) => fits(candidate))!;
  }
  const fill = (text: string) => text.replace(/\{([a-z_]+)\}/g, (_, slot: string) =>
    slotText(slots[slot], facts[slot], driverIds));
  return {
    id: story.id,
    section: story.section,
    kind: story.kind,
    headline: fill(wording.headline),
    body: fill(wording.body),
    drivers: driverIds.map((driverId) => ({ driverId, displayName: names.get(driverId)! })),
  };
}

export type PaperTextSegment = { text: string } | { driverId: string; displayName: string };

/** A rendered headline or body as plain runs and named drivers, in order. */
export function paperTextSegments(
  text: string,
  drivers: Array<{ driverId: string; displayName: string }>,
): PaperTextSegment[] {
  const names = new Map(drivers.map((driver) => [driver.driverId, driver.displayName]));
  const segments: PaperTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{@([a-z0-9_-]+)\}/g)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    const displayName = names.get(match[1]);
    segments.push(displayName === undefined ? { text: "" } : { driverId: match[1], displayName });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.filter((segment) => !("text" in segment) || segment.text !== "");
}

/** The same text with each marker replaced by the driver's name. */
export function paperTextPlain(text: string, drivers: Array<{ driverId: string; displayName: string }>) {
  return paperTextSegments(text, drivers)
    .map((segment) => ("text" in segment ? segment.text : segment.displayName))
    .join("");
}

// --- Front page ---
//
// Ranking, highest first, from the design: a million-mile driver, a first
// delivery into a city, own authority, a record week beating the paper's
// all-time best, a promotion, the week's most miles. Everything else ranks
// below those and reaches the front page only on a quiet week.

export const STORY_RANK: Record<string, number> = {
  mile_club_million: 100,
  first_into_city: 90,
  own_authority: 80,
  record_week_miles: 70,
  promotion: 60,
  most_miles: 50,
};

export function storyRank(kind: string, facts: Record<string, FactValue>) {
  if (kind === "mile_club" && facts.mark === 1_000_000) return STORY_RANK.mile_club_million;
  return STORY_RANK[kind] ?? (kind === "mile_club" ? 40 : 10);
}

/**
 * The top three named stories by rank. A tie goes to the driver whose last
 * front-page story is oldest (never on the front page counts as oldest), then
 * to the story id, so the same names do not lead every week.
 */
export function pickFrontPage(
  stories: PaperStory[],
  lastFrontPage: ReadonlyMap<string, number>,
  count = 3,
) {
  return stories
    .filter((story) => story.driverIds.length > 0)
    .sort((a, b) => b.rank - a.rank
      || (lastFrontPage.get(a.driverIds[0]) ?? 0) - (lastFrontPage.get(b.driverIds[0]) ?? 0)
      || a.id.localeCompare(b.id))
    .slice(0, count);
}
