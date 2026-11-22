// The paper's pages on the server: the masthead, the fixed words from the
// wording files, the game news story built from the releases the site already
// reads, the reads themselves (or the local fixture), and the feed.
//
// Importing lib/freight-fate-paper.ts here means a bad wording file fails
// `next build`, since every news route imports this module.
import { unstable_cache } from "next/cache";
import {
  PAPER_BACK_PAGE,
  PAPER_PHRASES,
  renderPaperEdition,
  renderPaperStory,
  weekStartMs,
  weeksCovered,
  whenPhrase,
  type StoredPaperEdition,
} from "./freight-fate-paper";
import { getFreightFatePaperEdition, getFreightFatePaperEditions } from "./freight-fate-online";
import { getLatestStableRelease, getReleases, type GitHubRelease } from "./github";
import {
  frontPageHeadlines,
  paperIssueDay,
  paperIssueHref,
  type PaperChrome,
  type PaperEditionData,
  type PaperGameNews,
  type PaperIssueListing,
} from "./freight-fate-paper-view";
import fixture from "../test-fixtures/freight-fate-paper-edition.json";

/** The paper's name. Not settled; a rename is this line. */
export const PAPER_NAME = "The Mile Marker";

export const PAPER_CHROME: PaperChrome = {
  masthead: PAPER_NAME,
  sinceMondayHeading: "Since Monday",
  backPageHeading: PAPER_BACK_PAGE.heading,
  records: { caption: PAPER_PHRASES.tables.records.caption, columns: PAPER_PHRASES.tables.records.columns },
  standings: {
    caption: PAPER_PHRASES.tables.carrier_standings.caption,
    columns: PAPER_PHRASES.tables.carrier_standings.columns,
  },
};

// --- Game news ---

const FREIGHT_FATE_REPO = "Freight-Fate";

function isStableRelease(release: GitHubRelease) {
  return !release.prerelease && !release.tag_name.toLowerCase().startsWith("nightly");
}

/** "1.9.7" from a tag such as "v1.9.7". */
export function releaseVersion(release: Pick<GitHubRelease, "tag_name">) {
  return release.tag_name.trim().replace(/^v(?=\d)/i, "");
}

/**
 * One game_release story per stable release, worded from the phrases file
 * with the edition's {when} ("this week", "in the last two weeks"). The page
 * keeps the ones inside the edition's period.
 */
export function gameNewsFromReleases(releases: GitHubRelease[], when = whenPhrase(1)): PaperGameNews[] {
  const seen = new Set<string>();
  const news: PaperGameNews[] = [];
  for (const release of releases) {
    if (!isStableRelease(release) || !release.published_at || seen.has(release.tag_name)) continue;
    seen.add(release.tag_name);
    const version = releaseVersion(release);
    const story = renderPaperStory({
      id: `game_release.${version}`, section: "game_news", kind: "game_release",
      driverIds: [], facts: { version }, variant: 0, rank: 0,
    }, new Map(), PAPER_PHRASES, when);
    if (!story) continue;
    news.push({
      id: story.id,
      publishedAt: Date.parse(release.published_at),
      headline: story.headline,
      body: story.body,
      link: { href: release.html_url, label: `Release notes for Freight Fate ${version}` },
    });
  }
  return news;
}

/** Stable releases the site already reads, as game news. Empty when GitHub cannot be reached. */
/** The {when} wording for an edition's period. */
export function paperWhen(periodStart: number, periodEnd: number) {
  return whenPhrase(weeksCovered(periodStart, periodEnd));
}

export async function getPaperGameNews(when?: string): Promise<PaperGameNews[]> {
  if (paperFixtureEnabled()) return gameNewsFromReleases([FIXTURE_RELEASE], when);
  try {
    const [releases, latest] = await Promise.all([
      getReleases(FREIGHT_FATE_REPO),
      getLatestStableRelease(FREIGHT_FATE_REPO),
    ]);
    return gameNewsFromReleases([...(latest ? [latest] : []), ...releases], when);
  } catch {
    return [];
  }
}

// --- Reads ---

/**
 * The local fixture stands in for the backend on a development server with
 * FREIGHT_FATE_PAPER_FIXTURE=1 (the accessibility spec and reviews use it).
 * Never in production.
 */
export function paperFixtureEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.FREIGHT_FATE_PAPER_FIXTURE === "1";
}

type PaperFixture = {
  latestIssue: number;
  drivers: Record<string, string>;
  edition: StoredPaperEdition;
};

const FIXTURE_RELEASE: GitHubRelease = {
  tag_name: "v1.9.7",
  name: "Freight Fate 1.9.7",
  body: null,
  html_url: "https://github.com/orinks-games/Freight-Fate/releases/tag/v1.9.7",
  published_at: "2026-11-21T22:29:00Z",
  prerelease: false,
  assets: [],
};

const WEEK_MS = 7 * 24 * 60 * 60_000;
const HALF_DAY_MS = 12 * 60 * 60_000;

/** An Eastern midnight `weeks` weeks earlier, across daylight time changes. */
function weeksBack(ms: number, weeks: number) {
  return weekStartMs(ms - weeks * WEEK_MS + HALF_DAY_MS);
}

/** The fixture edition as issue `issue`: the stored one, shifted back a week per issue. */
export function fixtureEdition(issue?: number): PaperEditionData | null {
  const data = fixture as unknown as PaperFixture;
  const wanted = issue ?? data.latestIssue;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > data.latestIssue) return null;
  const weeks = data.latestIssue - wanted;
  const stored = data.edition;
  const edition: StoredPaperEdition = {
    ...stored,
    issue: wanted,
    periodStart: weeksBack(stored.periodStart, weeks),
    periodEnd: weeksBack(stored.periodEnd, weeks),
    publishedAt: stored.publishedAt === undefined ? undefined : stored.publishedAt - weeks * WEEK_MS,
    sinceMonday: wanted === data.latestIssue ? stored.sinceMonday : undefined,
  };
  return renderPaperEdition(edition, new Map(Object.entries(data.drivers))) as PaperEditionData;
}

export function fixtureListings(): PaperIssueListing[] {
  const data = fixture as unknown as PaperFixture;
  return Array.from({ length: data.latestIssue }, (_, index) => {
    const issue = data.latestIssue - index;
    return {
      issue,
      weekKey: "",
      publishedAt: (data.edition.publishedAt ?? data.edition.periodEnd) - index * WEEK_MS,
      state: "published",
      periodStart: weeksBack(data.edition.periodStart, index),
      periodEnd: weeksBack(data.edition.periodEnd, index),
    };
  });
}

export type PaperRead<T> = { ok: true; value: T } | { ok: false };

/** The latest published edition, or one by issue; null when there is none or the paper is off. */
export async function readPaperEdition(issue?: number): Promise<PaperRead<PaperEditionData | null>> {
  if (paperFixtureEnabled()) return { ok: true, value: fixtureEdition(issue) };
  try {
    return { ok: true, value: (await getFreightFatePaperEdition(issue)) as PaperEditionData | null };
  } catch {
    return { ok: false };
  }
}

/** Published issues, newest first; null when the paper is off. */
export async function readPaperListings(): Promise<PaperRead<PaperIssueListing[] | null>> {
  if (paperFixtureEnabled()) return { ok: true, value: fixtureListings() };
  try {
    return { ok: true, value: (await getFreightFatePaperEditions()) as PaperIssueListing[] | null };
  } catch {
    return { ok: false };
  }
}

/** Whether to link to the paper from other pages: a published edition exists. Never throws. */
export async function paperIsPublished() {
  const listings = await readPaperListings();
  return listings.ok && (listings.value ?? []).some((row) => row.state === "published");
}

/** The link other pages carry to the paper, or null until an edition is published. */
export async function paperLink() {
  return (await paperIsPublished()) ? { href: "/freight-fate/news", label: `${PAPER_NAME}, the weekly driver newspaper` } : null;
}

// --- Feed ---

export const PAPER_FEED_ITEMS = 10;

// Older editions change only when a driver's name or sharing does, so the
// feed reads them through a six-hour cache: ten editions at about 7 KB each,
// four times a day, is well under a megabyte of backend reads a day. The
// newest edition comes through the page's own five-minute cache.
const cachedFeedEdition = unstable_cache(
  async (issue: number) => getFreightFatePaperEdition(issue),
  ["freight-fate-paper-feed"],
  { revalidate: 6 * 60 * 60, tags: ["freight-fate-paper"] },
);

export type PaperFeedItem = { issue: number; publishedAt: number | null; weekKey: string; headlines: string[] };

export async function readPaperFeedItems(): Promise<PaperFeedItem[] | null> {
  const listings = await readPaperListings();
  if (!listings.ok || !listings.value) return null;
  const published = listings.value.filter((row) => row.state === "published")
    .sort((a, b) => b.issue - a.issue).slice(0, PAPER_FEED_ITEMS);
  const items: PaperFeedItem[] = [];
  for (const [index, row] of published.entries()) {
    let edition: PaperEditionData | null = null;
    try {
      edition = paperFixtureEnabled()
        ? fixtureEdition(row.issue)
        : (await (index === 0 ? getFreightFatePaperEdition(row.issue) : cachedFeedEdition(row.issue))) as PaperEditionData | null;
    } catch {
      edition = null;
    }
    items.push({ issue: row.issue, publishedAt: row.publishedAt, weekKey: row.weekKey, headlines: edition ? frontPageHeadlines(edition) : [] });
  }
  return items;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** RSS 2.0, one item per published edition, newest first. */
export function paperFeedXml(siteUrl: string, items: PaperFeedItem[], name = PAPER_NAME) {
  const body = items.map((item) => {
    const link = `${siteUrl}${paperIssueHref(item.issue)}`;
    const day = paperIssueDay({ publishedAt: item.publishedAt, weekKey: item.weekKey });
    const lines = [
      "    <item>",
      `      <title>${escapeXml(`${name}, issue ${item.issue}`)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${new Date(item.publishedAt ?? Date.parse(`${day.iso}T12:00:00Z`)).toUTCString()}</pubDate>`,
    ];
    if (item.headlines.length > 0) {
      lines.push(`      <description>${escapeXml(item.headlines.map((line) => line.replace(/[.!?]$/, "")).join(". ") + ".")}</description>`);
    }
    lines.push("    </item>");
    return lines.join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(name)}</title>`,
    `    <link>${escapeXml(`${siteUrl}/freight-fate/news`)}</link>`,
    `    <atom:link href="${escapeXml(`${siteUrl}/freight-fate/news/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    "    <description>The weekly paper about Freight Fate drivers.</description>",
    "    <language>en-us</language>",
    ...body,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
