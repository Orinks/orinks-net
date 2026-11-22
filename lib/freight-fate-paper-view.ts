// What the paper's pages show, built from one rendered edition (the shape
// convex/freightFatePaper.ts renderEdition returns). No wording or catalog
// data is imported here: the server passes the chrome (masthead, table
// captions, the back page heading) in, so the owner's preview can build the
// same view in the browser. lib/freight-fate-paper-page.ts builds the chrome
// and the game news on the server.
import { formatPaperNumber, paperTextSegments, type PaperTextSegment } from "./freight-fate-paper-text";

export type PaperDriverName = { driverId: string; displayName: string };

export type PaperRenderedStory = {
  id: string;
  section: string;
  kind: string;
  headline: string;
  body: string;
  drivers: PaperDriverName[];
};

/** renderEdition's answer, as the site's reads return it. */
export type PaperEditionData = {
  issue: number;
  weekKey: string;
  periodStart: number;
  periodEnd: number;
  state: string;
  publishedAt: number | null;
  sections: Record<string, string>;
  stories: PaperRenderedStory[];
  records: Array<{ record: string; label: string; value: number; driverId: string; displayName: string }>;
  standings: Array<{ carrierKey: string; carrier: string; drivers: number; loads: number; miles: number; onTimeRate?: number }>;
  backPage: Array<{ id: string; kind: string; kindLabel: string; title: string; body: string[] }>;
  sinceMonday: { weekKey: string; asOf: number; drivers: number; loads: number; miles: number; tons: number } | null;
};

export type PaperIssueListing = {
  issue: number;
  weekKey: string;
  publishedAt: number | null;
  state: string;
  periodStart?: number | null;
  periodEnd?: number | null;
};

export type PaperTableSpec = { caption: string; columns: string[] };

/** The fixed words around an edition, read on the server from the wording files. */
export type PaperChrome = {
  masthead: string;
  /** "Since Monday", followed on the page by the Monday's date. */
  sinceMondayHeading: string;
  backPageHeading: string;
  records: PaperTableSpec;
  standings: PaperTableSpec;
};

/** A stable release, already worded from the game_release kind. */
export type PaperGameNews = {
  id: string;
  publishedAt: number;
  headline: string;
  body: string;
  link: { href: string; label: string };
};

export type PaperViewStory = {
  id: string;
  headline: PaperTextSegment[];
  body: PaperTextSegment[];
  link?: { href: string; label: string };
};

export type PaperViewTable = {
  id: string;
  caption: string;
  columns: string[];
  rows: Array<{ header: string; cells: Array<PaperTextSegment> }>;
};

export type PaperViewSection = {
  key: string;
  heading: string;
  stories: PaperViewStory[];
  table?: PaperViewTable;
  paragraphs?: PaperTextSegment[][];
  /** A date the heading ends with: "Since Monday, November 23". */
  headingDay?: PaperDay;
  /** The "As of" day before the paragraph. */
  asOf?: PaperDay;
};

export type PaperDay = { iso: string; label: string };

export type PaperView = {
  masthead: string;
  issue: number;
  firstDay: PaperDay;
  lastDay: PaperDay;
  sections: PaperViewSection[];
  backPage: { heading: string; pieces: Array<{ id: string; title: string; body: string[] }> } | null;
};

// --- Eastern dates ---

const EASTERN = "America/New_York";
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN, year: "numeric", month: "2-digit", day: "2-digit" });
const longDay = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, dateStyle: "long" });
const weekdayMonthDay = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, weekday: "long", month: "long", day: "numeric" });

/** YYYY-MM-DD on an Eastern calendar. */
export function easternIsoDay(ms: number) {
  return isoDay.format(new Date(ms));
}

/** "November 16, 2026", Eastern. */
export function easternLongDay(ms: number) {
  return longDay.format(new Date(ms));
}

const DAY_MS = 24 * 60 * 60_000;
const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, year: "numeric", month: "long", day: "numeric" });

function parts(ms: number) {
  const out: Record<string, string> = {};
  for (const part of dayParts.formatToParts(new Date(ms))) out[part.type] = part.value;
  return { month: out.month, day: out.day, year: out.year };
}

/**
 * The first and last day an edition covers, worded as one range:
 * "November 16" to "22, 2026", "October 26" to "November 1, 2026", or with
 * both years when the range crosses one. periodEnd is the instant the period
 * closed (midnight Eastern), so the last day is the day before it. Every place
 * that names an issue's days uses this, so the list and the issue agree.
 */
export function paperPeriodDays(periodStart: number, periodEnd: number): { firstDay: PaperDay; lastDay: PaperDay } {
  const last = periodEnd - 1;
  const a = parts(periodStart);
  const b = parts(last);
  const firstLabel = a.year !== b.year ? `${a.month} ${a.day}, ${a.year}` : `${a.month} ${a.day}`;
  const lastLabel = a.year === b.year && a.month === b.month ? `${b.day}, ${b.year}` : `${b.month} ${b.day}, ${b.year}`;
  return {
    firstDay: { iso: easternIsoDay(periodStart), label: firstLabel },
    lastDay: { iso: easternIsoDay(last), label: lastLabel },
  };
}

/** "November 16 to 22, 2026". */
export function paperPeriodText(periodStart: number, periodEnd: number) {
  const { firstDay, lastDay } = paperPeriodDays(periodStart, periodEnd);
  return `${firstDay.label} to ${lastDay.label}`;
}

/** A listing's period; one without its own (written before the list kept it) is its closed week. */
export function listingPeriod(listing: Pick<PaperIssueListing, "weekKey" | "periodStart" | "periodEnd">) {
  if (typeof listing.periodStart === "number" && typeof listing.periodEnd === "number") {
    return { periodStart: listing.periodStart, periodEnd: listing.periodEnd };
  }
  // weekKey is the closed week's Monday. Noon UTC is Monday on an Eastern
  // calendar, and the week's last day is six days on.
  const monday = Date.parse(`${listing.weekKey}T12:00:00Z`);
  return { periodStart: monday, periodEnd: monday + 6 * DAY_MS + 1 };
}

/** "Issue 11, November 9 to 15, 2026". */
export function paperIssueLabel(listing: Pick<PaperIssueListing, "issue" | "weekKey" | "periodStart" | "periodEnd">) {
  const { periodStart, periodEnd } = listingPeriod(listing);
  return `Issue ${listing.issue}, ${paperPeriodText(periodStart, periodEnd)}`;
}

/** The day an issue was published, else the day after its period closed, for the feed. */
export function paperIssueDay(listing: Pick<PaperIssueListing, "publishedAt" | "weekKey">): PaperDay {
  if (listing.publishedAt !== null) {
    return { iso: easternIsoDay(listing.publishedAt), label: easternLongDay(listing.publishedAt) };
  }
  const monday = Date.parse(`${listing.weekKey}T12:00:00Z`) + 7 * DAY_MS;
  return { iso: easternIsoDay(monday), label: easternLongDay(monday) };
}

// --- Wording the page owns ---

function counted(value: number, one: string, other: string) {
  return `${formatPaperNumber(value)} ${value === 1 ? one : other}`;
}

const RECORD_UNITS: Record<string, [string, string]> = {
  most_miles: ["mile", "miles"],
  most_deliveries: ["load", "loads"],
  best_on_time: ["load", "loads"],
  longest_haul: ["mile", "miles"],
  heaviest_load: ["pound", "pounds"],
  most_new_cities: ["city", "cities"],
};

/** A record's value with its unit: "4,210 miles". */
export function paperRecordResult(record: string, value: number) {
  const unit = RECORD_UNITS[record];
  return unit ? counted(value, unit[0], unit[1]) : formatPaperNumber(value);
}

/** "96.5%", or "Not recorded" when the carrier's rate is missing. */
export function paperOnTime(rate: number | undefined) {
  return rate === undefined ? "Not recorded" : `${formatPaperNumber(rate)}%`;
}

/** The open week so far, as one sentence, or null when nothing was delivered yet. */
export function sinceMondaySentence(brief: NonNullable<PaperEditionData["sinceMonday"]>) {
  if (brief.loads <= 0) return null;
  const drivers = brief.drivers === 1 ? "1 driver has" : `${formatPaperNumber(brief.drivers)} drivers have`;
  return `${drivers} delivered ${counted(brief.loads, "load", "loads")} and `
    + `${counted(brief.tons, "ton", "tons")} of freight over ${counted(brief.miles, "mile", "miles")}.`;
}

function monthDayOnly(ms: number) {
  const { month, day } = parts(ms);
  return `${month} ${day}`;
}

export function sinceMondayAsOf(asOf: number): PaperDay {
  return { iso: new Date(asOf).toISOString(), label: weekdayMonthDay.format(new Date(asOf)) };
}

// --- Links ---

/**
 * A story's headline and body as segments, with each driver linked only the
 * first time the story names them. Later mentions are plain text, so a
 * reader tabbing through the page meets one link per driver per story.
 */
export function storySegments(story: Pick<PaperRenderedStory, "headline" | "body" | "drivers">) {
  const linked = new Set<string>();
  const once = (segments: PaperTextSegment[]) => segments.map((segment) => {
    if ("text" in segment) return segment;
    if (linked.has(segment.driverId)) return { text: segment.displayName };
    linked.add(segment.driverId);
    return segment;
  });
  return {
    headline: once(paperTextSegments(story.headline, story.drivers)),
    body: once(paperTextSegments(story.body, story.drivers)),
  };
}

export function paperIssueHref(issue: number) {
  return `/freight-fate/news/${issue}`;
}

export const PAPER_HREF = "/freight-fate/news";
export const PAPER_ARCHIVE_HREF = "/freight-fate/news/archive";
export const PAPER_PAGE_SIZE = 20;

// --- The view ---

/** Game news inside the edition's period, oldest first. */
export function gameNewsInPeriod(news: PaperGameNews[], periodStart: number, periodEnd: number) {
  return news
    .filter((item) => item.publishedAt >= periodStart && item.publishedAt < periodEnd)
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

export function buildPaperView(
  edition: PaperEditionData,
  chrome: PaperChrome,
  options: { latest: boolean; gameNews: PaperGameNews[] },
): PaperView {
  const sections: PaperViewSection[] = [];

  const brief = edition.sinceMonday;
  // The brief is about the open week, which is always after the week the
  // edition closed; a brief from the edition's own week is stale.
  if (options.latest && brief && brief.weekKey > edition.weekKey) {
    const sentence = sinceMondaySentence(brief);
    if (sentence) {
      const monday = Date.parse(`${brief.weekKey}T12:00:00Z`);
      sections.push({
        key: "since_monday", heading: chrome.sinceMondayHeading, stories: [],
        headingDay: { iso: brief.weekKey, label: monthDayOnly(monday) },
        asOf: sinceMondayAsOf(brief.asOf),
        paragraphs: [[{ text: sentence }]],
      });
    }
  }

  const gameNews = gameNewsInPeriod(options.gameNews, edition.periodStart, edition.periodEnd);
  for (const [key, heading] of Object.entries(edition.sections)) {
    if (key === "back_page") continue;
    if (key === "records") {
      if (edition.records.length > 0) {
        sections.push({
          key, heading, stories: [],
          table: {
            id: "paper-records-caption",
            caption: chrome.records.caption,
            columns: chrome.records.columns,
            rows: edition.records.map((row) => ({
              header: row.label,
              cells: [
                { driverId: row.driverId, displayName: row.displayName },
                { text: paperRecordResult(row.record, row.value) },
              ],
            })),
          },
        });
      }
      continue;
    }
    if (key === "carrier_standings") {
      if (edition.standings.length > 0) {
        sections.push({
          key, heading, stories: [],
          table: {
            id: "paper-standings-caption",
            caption: chrome.standings.caption,
            columns: chrome.standings.columns,
            rows: edition.standings.map((row) => ({
              header: row.carrier,
              cells: [
                { text: formatPaperNumber(row.drivers) },
                { text: formatPaperNumber(row.loads) },
                { text: formatPaperNumber(row.miles) },
                { text: paperOnTime(row.onTimeRate) },
              ],
            })),
          },
        });
      }
      continue;
    }
    const stories: PaperViewStory[] = key === "game_news"
      ? gameNews.map((item) => ({
        id: item.id, headline: [{ text: item.headline }], body: [{ text: item.body }], link: item.link,
      }))
      : edition.stories.filter((story) => story.section === key)
        .map((story) => ({ id: story.id, ...storySegments(story) }));
    if (stories.length > 0) sections.push({ key, heading, stories });
  }

  const { firstDay, lastDay } = paperPeriodDays(edition.periodStart, edition.periodEnd);
  return {
    masthead: chrome.masthead,
    issue: edition.issue,
    firstDay,
    lastDay,
    sections,
    backPage: edition.backPage.length > 0
      ? {
        heading: chrome.backPageHeading,
        pieces: edition.backPage.map((piece) => ({ id: piece.id, title: `${piece.kindLabel}: ${piece.title}`, body: piece.body })),
      }
      : null,
  };
}

/** The headlines a feed item or a summary lists: the front page's, as plain text. */
export function frontPageHeadlines(edition: Pick<PaperEditionData, "stories">) {
  return edition.stories
    .filter((story) => story.section === "front_page")
    .map((story) => paperTextSegments(story.headline, story.drivers)
      .map((segment) => ("text" in segment ? segment.text : segment.displayName)).join(""));
}

/**
 * One page of the earlier-issues list: the published issues before `before`,
 * newest first, with links to the next page each way when there is one.
 */
export function earlierIssues(listings: PaperIssueListing[], before: number, size = PAPER_PAGE_SIZE) {
  const published = listings.filter((row) => row.state === "published").sort((a, b) => b.issue - a.issue);
  const older = published.filter((row) => row.issue < before);
  const page = older.slice(0, size);
  const latest = published[0]?.issue;
  return {
    issues: page.map((row) => ({ issue: row.issue, href: paperIssueHref(row.issue), label: paperIssueLabel(row) })),
    olderHref: older.length > size ? `${PAPER_ARCHIVE_HREF}?before=${page.at(-1)!.issue}` : null,
    // The page above this one. The top page lists the issues before the
    // latest, the way the latest edition's own list does.
    newerHref: latest !== undefined && before < latest
      ? `${PAPER_ARCHIVE_HREF}?before=${Math.min(before + size, latest)}` : null,
    range: page.length > 0 ? { newest: page[0].issue, oldest: page.at(-1)!.issue } : null,
  };
}
