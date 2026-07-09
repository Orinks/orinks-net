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
