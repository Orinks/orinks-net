// The driver newspaper: a weekly edition on orinks.net written from what
// Freight Fate drivers did, plus a "since Monday" brief between editions.
//
// The daily job (below) reads the driver events posted since it last ran into
// the open week's tallies. The weekly job (freightFatePaperWeekly.ts) closes
// the week every Monday: it compares each nameable driver's verified snapshot
// with their ledger row from the last edition, builds the stories, and
// publishes. Editions store driver ids and facts; getEdition renders the text
// per read, so a driver who stops being nameable leaves old editions too.
//
// Everything is behind FREIGHT_FATE_PAPER: off (the default) reads nothing
// and answers null; preview builds editions only the games admin can read;
// on publishes. Rules shared with the page are in lib/freight-fate-paper.ts.
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { maskDisplayName } from "./moderation";
import { isGamesAdmin } from "./games";
import {
  CARGO_KEYS,
  DAY_MS,
  MAX_EVENT_MILES,
  MAX_EVENT_POUNDS,
  PAPER_BACK_PAGE,
  PAPER_PHRASES,
  WEATHER_KEY,
  cargoKeyFromText,
  cityKeyFromPlace,
  cityKeyFromText,
  editionReadable,
  easternWeekday,
  isAchievementKey,
  isCityKey,
  nextEditionState,
  paperMode,
  renderPaperStory,
  weekKeyOf,
  weekStartMs,
  weeksCovered,
  whenPhrase,
  type EditionEvent,
  type EditionState,
  type PaperStory,
} from "../lib/freight-fate-paper";
import { ALL_LINES } from "../lib/freight-fate-invariants";

// The paper's own copy of the sharing consent version (freightFate.ts
// SHARING_CONSENT_VERSION). Importing freightFate.ts here would pull the
// whole REST surface into every paper function; the test suite pins the two
// together.
export const PAPER_SHARING_CONSENT_VERSION = 3;

export function paperModeNow() {
  return paperMode(process.env.FREIGHT_FATE_PAPER);
}

/**
 * Whether a driver may be named in the paper: an account, not a guest, with
 * Profile sharing on at the current consent version, no integrity flag, no
 * pending moderation rename, and a name the display screen leaves as it is.
 * Checked when an edition is built and again every time it is read.
 */
export function paperNameable(driver: Doc<"freightFateDrivers"> | null | undefined): driver is Doc<"freightFateDrivers"> {
  return !!driver
    && driver.guest !== true
    && driver.authSubject !== undefined
    && driver.visibility === "public"
    && driver.sharingConsentVersion === PAPER_SHARING_CONSENT_VERSION
    && !driver.integrityFlag
    && driver.needsRename !== true
    && maskDisplayName(driver.displayName, driver.driverId, "Driver") === driver.displayName;
}

const STATE_KEY = "paper";
// Events a daily batch reads at most; the action repeats until caught up.
export const DAILY_BATCH = 400;
// Events newer than this are left for the next run: a transaction that began
// earlier can still commit an event with an earlier creation time.
export const DAILY_SETTLE_MS = 5 * 60_000;

export async function readPaperState(ctx: QueryCtx) {
  return await ctx.db.query("freightFatePaperState")
    .withIndex("by_key", (q) => q.eq("key", STATE_KEY)).unique();
}

export async function ensurePaperState(ctx: MutationCtx, now: number) {
  const existing = await readPaperState(ctx);
  if (existing) return existing;
  const id = await ctx.db.insert("freightFatePaperState", {
    key: STATE_KEY,
    seeded: false,
    seedCursor: null,
    // Launch week counts from its own Monday.
    cursor: weekStartMs(now),
    lastIssue: 0,
    periodStart: weekStartMs(now),
    failures: [],
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

// --- Delivery facts ---

type JsonObject = Record<string, unknown>;

function objectOf(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

/**
 * The catalog facts of one delivery event. A version 2 payload's keys are
 * used and its text ignored; a version 1 payload's text is matched exactly
 * against the catalog, and a miss leaves the fact out. A load past either cap
 * keeps only its keys. `notableCondition` is never read.
 */
export function deliveryFacts(row: Pick<Doc<"freightFateDriverEvents">, "payload" | "payloadVersion">) {
  const payload = objectOf(row.payload) ?? {};
  const v2 = row.payloadVersion === 2 || payload.version === 2;
  const cargoKey = v2
    ? (typeof payload.cargoKey === "string" && CARGO_KEYS.has(payload.cargoKey) ? payload.cargoKey : undefined)
    : cargoKeyFromText(payload.cargo);
  const originKey = v2 ? (isCityKey(payload.originKey) ? payload.originKey : undefined) : cityKeyFromText(payload.origin);
  const destinationKey = v2
    ? (isCityKey(payload.destinationKey) ? payload.destinationKey : undefined)
    : cityKeyFromText(payload.destination);
  const miles = typeof payload.distanceMiles === "number" && Number.isFinite(payload.distanceMiles)
    ? Math.max(0, Math.round(payload.distanceMiles)) : undefined;
  const pounds = typeof payload.weightPounds === "number" && Number.isFinite(payload.weightPounds)
    ? Math.max(0, Math.round(payload.weightPounds)) : undefined;
  const capped = (miles ?? 0) > MAX_EVENT_MILES || (pounds ?? 0) > MAX_EVENT_POUNDS;
  return {
    capped,
    facts: {
      ...(capped || miles === undefined ? {} : { miles }),
      ...(capped || pounds === undefined ? {} : { pounds }),
      ...(cargoKey ? { cargoKey } : {}),
      ...(originKey ? { originKey } : {}),
      ...(destinationKey ? { destinationKey } : {}),
    },
    onTime: payload.onTime === true,
    conditions: v2 ? objectOf(payload.conditions) : undefined,
  };
}

// --- Daily job ---

type WeekTally = Omit<Doc<"freightFatePaperWeekTallies">, "_id" | "_creationTime">;
type DriverTally = Omit<Doc<"freightFatePaperDriverTallies">, "_id" | "_creationTime">;

function emptyWeek(weekKey: string, now: number): WeekTally {
  return {
    weekKey, loads: 0, miles: 0, pounds: 0, drivers: 0, lanes: [], cargo: [],
    conditions: { loads: 0, chainLaw: 0, workZones: 0, scales: 0, inspections: 0, weather: [] },
    updatedAt: now,
  };
}

function bump<T extends { count: number }>(rows: T[], match: (row: T) => boolean, make: () => T) {
  const row = rows.find(match);
  if (row) row.count += 1;
  else rows.push({ ...make(), count: 1 });
  return row ?? rows.at(-1)!;
}

/** One batch of events into the tallies. Safe to repeat: the cursor moves with them. */
export async function runDailyBatch(ctx: MutationCtx, now: number) {
  if (paperModeNow() === "off") return { done: true, read: 0 };
  const state = await ensurePaperState(ctx, now);
  const until = now - DAILY_SETTLE_MS;
  const events = await ctx.db.query("freightFateDriverEvents")
    .withIndex("by_creation_time", (q) => q.gt("_creationTime", state.cursor).lt("_creationTime", until))
    .take(DAILY_BATCH);
  if (events.length === 0) return { done: true, read: 0 };

  const drivers = new Map<string, Doc<"freightFateDrivers"> | null>();
  const weeks = new Map<string, { id?: Doc<"freightFatePaperWeekTallies">["_id"]; row: WeekTally }>();
  const tallies = new Map<string, { id?: Doc<"freightFatePaperDriverTallies">["_id"]; row: DriverTally }>();
  const citiesSeen = new Set<string>();

  const weekOf = async (weekKey: string) => {
    let entry = weeks.get(weekKey);
    if (!entry) {
      const found = await ctx.db.query("freightFatePaperWeekTallies")
        .withIndex("by_week", (q) => q.eq("weekKey", weekKey)).unique();
      entry = found
        ? { id: found._id, row: { ...found, _id: undefined, _creationTime: undefined } as unknown as WeekTally }
        : { row: emptyWeek(weekKey, now) };
      weeks.set(weekKey, entry);
    }
    return entry.row;
  };
  const tallyOf = async (driverId: string, weekKey: string) => {
    const key = `${driverId}\n${weekKey}`;
    let entry = tallies.get(key);
    if (!entry) {
      const found = await ctx.db.query("freightFatePaperDriverTallies")
        .withIndex("by_driver_week", (q) => q.eq("driverId", driverId).eq("weekKey", weekKey)).unique();
      entry = found
        ? { id: found._id, row: { ...found, _id: undefined, _creationTime: undefined } as unknown as DriverTally }
        : { row: { weekKey, driverId, deliveries: 0, achievements: [] } };
      tallies.set(key, entry);
    }
    return entry.row;
  };

  for (const event of events) {
    let driver = drivers.get(event.driverId);
    if (driver === undefined) {
      driver = await ctx.db.query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", event.driverId)).unique();
      drivers.set(event.driverId, driver);
    }
    if (!paperNameable(driver)) continue;
    const weekKey = weekKeyOf(event._creationTime);
    const payload = objectOf(event.payload);

    if (event.eventType === "delivery_completed") {
      const { facts, conditions } = deliveryFacts(event);
      const tally = await tallyOf(event.driverId, weekKey);
      const week = await weekOf(weekKey);
      if (tally.deliveries === 0) week.drivers += 1;
      tally.deliveries += 1;
      tally.firstLoad ??= facts;
      if (facts.miles !== undefined && facts.miles > (tally.longest?.miles ?? 0)) tally.longest = facts;
      if (facts.pounds !== undefined && facts.pounds > (tally.heaviest?.pounds ?? 0)) tally.heaviest = facts;
      week.loads += 1;
      week.miles += facts.miles ?? 0;
      week.pounds += facts.pounds ?? 0;
      if (facts.originKey && facts.destinationKey) {
        const { originKey, destinationKey } = facts;
        bump(week.lanes, (lane) => lane.originKey === originKey && lane.destinationKey === destinationKey,
          () => ({ originKey, destinationKey, count: 0 }));
      }
      if (facts.cargoKey) {
        const cargoKey = facts.cargoKey;
        bump(week.cargo, (row) => row.key === cargoKey, () => ({ key: cargoKey, count: 0, pounds: 0 }))
          .pounds += facts.pounds ?? 0;
      }
      if (conditions) {
        week.conditions.loads += 1;
        if (conditions.chainLaw === true) week.conditions.chainLaw += 1;
        for (const field of ["workZones", "scales", "inspections"] as const) {
          const value = conditions[field];
          if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 500) {
            week.conditions[field] += value as number;
          }
        }
        const weather = Array.isArray(conditions.weather) ? conditions.weather : [];
        for (const key of new Set(weather.filter((item): item is string =>
          typeof item === "string" && WEATHER_KEY.test(item)).slice(0, 8))) {
          bump(week.conditions.weather, (row) => row.key === key, () => ({ key, count: 0 }));
        }
      }
      const cityKey = facts.destinationKey;
      if (cityKey && !citiesSeen.has(cityKey)) {
        citiesSeen.add(cityKey);
        const first = await ctx.db.query("freightFatePaperFirsts")
          .withIndex("by_city", (q) => q.eq("cityKey", cityKey)).first();
        if (!first) {
          await ctx.db.insert("freightFatePaperFirsts", {
            cityKey, driverId: event.driverId, firstAt: event._creationTime,
            seeded: false, reported: false, load: facts,
          });
        }
      }
    } else if (event.eventType === "achievement_earned") {
      const key = payload?.achievementKey;
      if (isAchievementKey(key)) {
        const tally = await tallyOf(event.driverId, weekKey);
        if (!tally.achievements.includes(key)) tally.achievements.push(key);
      }
    } else if (event.eventType === "career_milestone" && payload?.milestoneType === "first_delivery") {
      (await tallyOf(event.driverId, weekKey)).firstDelivery = true;
    }
  }

  for (const entry of weeks.values()) {
    entry.row.updatedAt = now;
    if (entry.id) await ctx.db.replace(entry.id, entry.row);
    else await ctx.db.insert("freightFatePaperWeekTallies", entry.row);
  }
  for (const entry of tallies.values()) {
    if (entry.id) await ctx.db.replace(entry.id, entry.row);
    else await ctx.db.insert("freightFatePaperDriverTallies", entry.row);
  }
  await ctx.db.patch(state._id, { cursor: events.at(-1)!._creationTime, updatedAt: now });
  return { done: events.length < DAILY_BATCH, read: events.length };
}

export const dailyBatch = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => runDailyBatch(ctx, args.now),
});

/**
 * The first run ever: every nameable driver's delivered cities go into the
 * firsts table as already visited, so launch week does not report six
 * hundred firsts. One page of drivers per call.
 */
export async function seedFirstsRun(ctx: MutationCtx, now: number) {
  if (paperModeNow() === "off") return { done: true };
  const state = await ensurePaperState(ctx, now);
  if (state.seeded) return { done: true };
  const page = await ctx.db.query("freightFateDrivers")
    .paginate({ numItems: 100, cursor: state.seedCursor ?? null });
  const known = new Set<string>();
  for (const driver of page.page) {
    if (!paperNameable(driver)) continue;
    const snapshot = await ctx.db.query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId)).unique();
    for (const place of snapshot?.visitedPlaces ?? []) {
      for (const city of place.cities) {
        const cityKey = cityKeyFromPlace(city, place.state);
        if (!cityKey || known.has(cityKey)) continue;
        known.add(cityKey);
        const first = await ctx.db.query("freightFatePaperFirsts")
          .withIndex("by_city", (q) => q.eq("cityKey", cityKey)).first();
        if (!first) {
          await ctx.db.insert("freightFatePaperFirsts", {
            cityKey, firstAt: now, seeded: true, reported: true,
          });
        }
      }
    }
  }
  await ctx.db.patch(state._id, page.isDone
    ? { seeded: true, seedCursor: null, updatedAt: now }
    : { seedCursor: page.continueCursor, updatedAt: now });
  return { done: page.isDone };
}

export const seedFirstsPage = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => seedFirstsRun(ctx, args.now),
});

export function sinceMondayOf(week: Pick<WeekTally, "weekKey" | "drivers" | "loads" | "miles" | "pounds" | "updatedAt">) {
  return {
    weekKey: week.weekKey,
    asOf: week.updatedAt,
    drivers: week.drivers,
    loads: week.loads,
    miles: week.miles,
    tons: Math.round(week.pounds / 2000),
  };
}

/** Puts the open week's running totals on the newest edition. */
export async function refreshSinceMonday(ctx: MutationCtx, now: number) {
  const weekKey = weekKeyOf(now);
  const week = await ctx.db.query("freightFatePaperWeekTallies")
    .withIndex("by_week", (q) => q.eq("weekKey", weekKey)).unique();
  const edition = await ctx.db.query("freightFatePaperEditions").withIndex("by_issue").order("desc").first();
  if (!week || !edition) return false;
  const brief = sinceMondayOf(week);
  const same = edition.sinceMonday
    && (Object.keys(brief) as Array<keyof typeof brief>).every((key) => edition.sinceMonday![key] === brief[key]);
  if (same) return false;
  await ctx.db.patch(edition._id, { sinceMonday: brief });
  return true;
}

export const refreshSinceMondayNow = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    if (paperModeNow() === "off") return { changed: false };
    return { changed: await refreshSinceMonday(ctx, args.now) };
  },
});

// --- The schedule ---

/**
 * Every day at noon UTC (7:00 AM Eastern, 8:00 in summer): seed the firsts
 * on the first run ever, read the day's events, refresh the brief, and on a
 * Monday close the week. A failed weekly build leaves the last edition up
 * and puts one line in the owner's next review digest.
 */
export const runPaperSchedule = internalAction({
  args: { now: v.optional(v.number()), weekly: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ mode: string; events: number; weekly?: unknown }> => {
    const mode = paperModeNow();
    if (mode === "off") return { mode, events: 0 };
    const now = args.now ?? Date.now();
    for (let page = 0; page < 200; page += 1) {
      if ((await ctx.runMutation(internal.freightFatePaper.seedFirstsPage, { now })).done) break;
    }
    let events = 0;
    for (let batch = 0; batch < 100; batch += 1) {
      const result = await ctx.runMutation(internal.freightFatePaper.dailyBatch, { now });
      events += result.read;
      if (result.done) break;
    }
    await ctx.runMutation(internal.freightFatePaper.refreshSinceMondayNow, { now });
    if (!(args.weekly ?? easternWeekday(now) === 1)) return { mode, events };
    let weekly: unknown;
    try {
      const begun = await ctx.runMutation(internal.freightFatePaperWeekly.beginWeek, { now });
      if (begun.status === "building") {
        for (let page = 0; page < 500; page += 1) {
          if ((await ctx.runMutation(internal.freightFatePaperWeekly.scanDrivers, { now })).done) break;
        }
        weekly = await ctx.runMutation(internal.freightFatePaperWeekly.finishWeek, { now });
      } else {
        weekly = begun;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.freightFatePaper.recordFailure, { now, message });
      weekly = { status: "failed", message };
    }
    return { mode, events, weekly };
  },
});

export const recordFailure = internalMutation({
  args: { now: v.number(), message: v.string() },
  handler: async (ctx, args) => {
    const state = await ensurePaperState(ctx, args.now);
    const weekKey = weekKeyOf(weekStartMs(args.now) - 1);
    if (state.failures.some((failure) => failure.weekKey === weekKey)) return;
    await ctx.db.patch(state._id, {
      failures: [...state.failures.slice(-9), {
        at: args.now, weekKey, message: args.message.slice(0, 300), reported: false,
      }],
      updatedAt: args.now,
    });
  },
});

/** Lines for the owner's review digest: weekly builds that failed. */
export const unreportedFailures = internalQuery({
  args: {},
  handler: async (ctx) => {
    const state = await readPaperState(ctx);
    return (state?.failures ?? []).filter((failure) => !failure.reported)
      .map((failure) => `The paper did not publish for the week of ${failure.weekKey}: ${failure.message}`);
  },
});

export const markFailuresReported = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await readPaperState(ctx);
    if (!state || state.failures.every((failure) => failure.reported)) return;
    await ctx.db.patch(state._id, { failures: state.failures.map((failure) => ({ ...failure, reported: true })) });
  },
});

// --- Dashboard controls ---

async function editionByIssue(ctx: QueryCtx, issue: number) {
  return await ctx.db.query("freightFatePaperEditions")
    .withIndex("by_issue", (q) => q.eq("issue", issue)).unique();
}

export async function moveEdition(ctx: MutationCtx, edition: Doc<"freightFatePaperEditions">, event: EditionEvent, now: number) {
  const state: EditionState = nextEditionState(edition.state, event);
  await ctx.db.patch(edition._id, {
    state,
    ...(state === "published" && edition.publishedAt === undefined ? { publishedAt: now } : {}),
  });
  const listed = await ctx.db.query("freightFatePaperIssues")
    .withIndex("by_issue", (q) => q.eq("issue", edition.issue)).unique();
  const row = {
    issue: edition.issue, weekKey: edition.weekKey, state,
    publishedAt: state === "published" ? (edition.publishedAt ?? now) : edition.publishedAt,
  };
  if (listed) await ctx.db.replace(listed._id, row);
  else await ctx.db.insert("freightFatePaperIssues", row);
  return state;
}

/** Publishes a preview edition, or puts a pulled one back. */
export const publishEdition = internalMutation({
  args: { issue: v.number() },
  handler: async (ctx, args) => {
    const edition = await editionByIssue(ctx, args.issue);
    if (!edition) throw new Error(`No paper edition ${args.issue}`);
    return { state: await moveEdition(ctx, edition, "publish", Date.now()) };
  },
});

export const pullEdition = internalMutation({
  args: { issue: v.number() },
  handler: async (ctx, args) => {
    const edition = await editionByIssue(ctx, args.issue);
    if (!edition) throw new Error(`No paper edition ${args.issue}`);
    return { state: await moveEdition(ctx, edition, "pull", Date.now()) };
  },
});

/** Leaves one story out of an edition. `pulled: false` puts it back. */
export const pullStory = internalMutation({
  args: { issue: v.number(), storyId: v.string(), pulled: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const edition = await editionByIssue(ctx, args.issue);
    if (!edition) throw new Error(`No paper edition ${args.issue}`);
    if (!edition.stories.some((story) => story.id === args.storyId)) {
      throw new Error(`Edition ${args.issue} has no story ${args.storyId}`);
    }
    await ctx.db.patch(edition._id, {
      stories: edition.stories.map((story) => story.id === args.storyId
        ? { ...story, pulled: args.pulled ?? true } : story),
    });
  },
});

/**
 * Throws away the open week's tallies and reads its events again. For after
 * a fix to how events are counted; the next daily run finishes the job.
 */
export const rebuildOpenWeek = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const state = await ensurePaperState(ctx, now);
    const weekKey = weekKeyOf(now);
    const rows = await ctx.db.query("freightFatePaperDriverTallies")
      .withIndex("by_week", (q) => q.eq("weekKey", weekKey)).take(2000);
    for (const row of rows) await ctx.db.delete(row._id);
    const week = await ctx.db.query("freightFatePaperWeekTallies")
      .withIndex("by_week", (q) => q.eq("weekKey", weekKey)).unique();
    if (week) await ctx.db.delete(week._id);
    await ctx.db.patch(state._id, { cursor: Math.min(state.cursor, weekStartMs(now)), updatedAt: now });
    return { cleared: rows.length };
  },
});

// --- Reads ---

async function adminReader(ctx: QueryCtx) {
  return isGamesAdmin(await ctx.auth.getUserIdentity());
}

async function latestReadable(ctx: QueryCtx, admin: boolean) {
  const published = await ctx.db.query("freightFatePaperEditions")
    .withIndex("by_state_issue", (q) => q.eq("state", "published")).order("desc").first();
  if (!admin) return published;
  const preview = await ctx.db.query("freightFatePaperEditions")
    .withIndex("by_state_issue", (q) => q.eq("state", "preview")).order("desc").first();
  return !published || (preview && preview.issue > published.issue) ? preview : published;
}

/** The edition with its text, from the driver rows as they are now. */
export async function renderEdition(ctx: QueryCtx, edition: Doc<"freightFatePaperEditions">) {
  const ids = new Set<string>();
  for (const story of edition.stories) for (const id of story.driverIds) ids.add(id);
  for (const row of edition.records) ids.add(row.driverId);
  const names = new Map<string, string>();
  for (const driverId of ids) {
    const driver = await ctx.db.query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).unique();
    if (paperNameable(driver)) names.set(driverId, driver.displayName);
  }
  const when = whenPhrase(weeksCovered(edition.periodStart, edition.periodEnd));
  const stories = edition.stories
    .map((story) => renderPaperStory(story as PaperStory, names, PAPER_PHRASES, when))
    .filter((story) => story !== null);
  const recordLabels = PAPER_PHRASES.tables.records.rows as Record<string, string>;
  return {
    issue: edition.issue,
    weekKey: edition.weekKey,
    periodStart: edition.periodStart,
    periodEnd: edition.periodEnd,
    state: edition.state,
    publishedAt: edition.publishedAt ?? null,
    sections: PAPER_PHRASES.sections,
    stories,
    records: edition.records
      .filter((row) => names.has(row.driverId) && recordLabels[row.record])
      .map((row) => ({
        record: row.record, label: recordLabels[row.record], value: row.value,
        driverId: row.driverId, displayName: names.get(row.driverId)!,
      })),
    standings: edition.standings
      .filter((row) => ALL_LINES.carrierLabels[row.carrierKey])
      .map((row) => ({ ...row, carrier: ALL_LINES.carrierLabels[row.carrierKey] })),
    backPage: edition.backPage
      .map((id) => PAPER_BACK_PAGE.pieces.find((piece) => piece.id === id))
      .filter((piece) => piece !== undefined)
      .map((piece) => ({ ...piece, kindLabel: PAPER_BACK_PAGE.kinds[piece.kind] })),
    sinceMonday: edition.sinceMonday ?? null,
  };
}

/** The latest edition a reader may see, or one by number; null when there is none. */
export const getEdition = query({
  args: { issue: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const mode = paperModeNow();
    if (mode === "off") return null;
    const admin = await adminReader(ctx);
    const edition = args.issue === undefined
      ? await latestReadable(ctx, admin)
      : await editionByIssue(ctx, args.issue);
    if (!edition || !editionReadable(edition.state, mode, admin)) return null;
    return await renderEdition(ctx, edition);
  },
});

/** Issue numbers and dates, newest first. */
export const listEditions = query({
  args: {},
  handler: async (ctx) => {
    const mode = paperModeNow();
    if (mode === "off") return null;
    const admin = await adminReader(ctx);
    const rows = await ctx.db.query("freightFatePaperIssues").withIndex("by_issue").order("desc").take(1000);
    return rows
      .filter((row) => editionReadable(row.state, mode, admin))
      .map((row) => ({ issue: row.issue, weekKey: row.weekKey, publishedAt: row.publishedAt ?? null, state: row.state }));
  },
});

// --- Account deletion ---

/** Ledger and tallies go; a first stays visited but loses the driver. */
export async function purgePaperDriver(ctx: MutationCtx, driverId: string) {
  let deleted = 0;
  const owned = await Promise.all([
    ctx.db.query("freightFatePaperLedger").withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect(),
    ctx.db.query("freightFatePaperDriverTallies").withIndex("by_driver_week", (q) => q.eq("driverId", driverId)).collect(),
  ]);
  for (const rows of owned) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  const firsts = await ctx.db.query("freightFatePaperFirsts")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId)).collect();
  for (const row of firsts) {
    await ctx.db.patch(row._id, { driverId: undefined, load: undefined, reported: true });
  }
  return deleted;
}

export const PAPER_WEEK_MS = 7 * DAY_MS;
