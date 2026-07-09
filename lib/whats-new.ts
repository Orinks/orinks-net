// Relative import (not the @/ alias): vitest resolves this file too, and the
// test suite is this data's deploy gate.
import whatsNewData from "../data/whats-new.json";

export type WhatsNewEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  project: string;
  title: string;
  body: string[];
  link?: { href: string; label: string };
};

/**
 * Loads and VALIDATES the curated announcements. Throwing here is the point:
 * the /whats-new page calls this at build time, so a malformed entry fails
 * `next build` — and therefore CI — before any deploy on dev or main. The
 * vitest suite runs the same validation so the failure surfaces at the Test
 * step too, with a readable message.
 */
export function getWhatsNewEntries(): WhatsNewEntry[] {
  const entries = (whatsNewData as { entries: WhatsNewEntry[] }).entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("whats-new.json: entries must be a non-empty array");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    // Date-prefixed slug format keeps anchors URL-safe and can never collide
    // with the page's own section ids (a11y review).
    if (!entry.id || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(entry.id) || seen.has(entry.id)) {
      throw new Error(`whats-new.json: missing, malformed, or duplicate id "${entry.id}"`);
    }
    seen.add(entry.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date))) {
      throw new Error(`whats-new.json: entry "${entry.id}" has an invalid date "${entry.date}"`);
    }
    if (!entry.project?.trim() || !entry.title?.trim()) {
      throw new Error(`whats-new.json: entry "${entry.id}" needs a project and a title`);
    }
    if (!Array.isArray(entry.body) || entry.body.length === 0 || entry.body.some((p) => !p.trim())) {
      throw new Error(`whats-new.json: entry "${entry.id}" needs non-empty body paragraphs`);
    }
    if (entry.link) {
      if (!entry.link.href?.trim() || !entry.link.label?.trim()) {
        throw new Error(`whats-new.json: entry "${entry.id}" has a link without href or label`);
      }
      // Link-text quality is a BUILD gate, not just a test gate — the same
      // rules the vitest suite checks (a11y review: descriptive links).
      const label = entry.link.label.trim();
      if (label.length < 15 || /^(click here|here|read more|learn more|more|link)$/i.test(label)) {
        throw new Error(`whats-new.json: entry "${entry.id}" needs descriptive link text, got "${label}"`);
      }
    }
  }
  return [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** "2026-07-08" → "July 8, 2026" (UTC; entries are dates, not moments). */
export function formatAnnouncementDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * RSS 2.0 feed for /whats-new/feed.xml, built from the same validated
 * entries — so the feed inherits the announcement deploy gate for free.
 */
export function whatsNewFeedXml(siteName: string, siteUrl: string): string {
  const entries = getWhatsNewEntries();
  const items = entries
    .map((entry) => {
      const link = `${siteUrl}/whats-new#${entry.id}`;
      const description = entry.body.join(" ");
      return [
        "    <item>",
        `      <title>${escapeXml(`${entry.project}: ${entry.title}`)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <category>${escapeXml(entry.project)}</category>`,
        `      <description>${escapeXml(description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(`What's New — ${siteName}`)}</title>`,
    `    <link>${escapeXml(`${siteUrl}/whats-new`)}</link>`,
    `    <atom:link href="${escapeXml(`${siteUrl}/whats-new/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    "    <description>Announcements for the site, its games, and the featured projects.</description>",
    "    <language>en-us</language>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
