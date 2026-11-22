import { describe, expect, test } from "vitest";
import whatsNewData from "../data/whats-new.json";
import {
  formatAnnouncementDate,
  getWhatsNewEntries,
  publishedWhatsNewEntries,
  whatsNewFeedXml,
  type WhatsNewEntry,
} from "./whats-new";

// The deploy gate for curated announcements: a malformed entry fails this
// suite (and the build) on every dev and main push, before any deploy.
describe("whats-new announcements", () => {
  test("the data file validates and sorts newest first", () => {
    const entries = getWhatsNewEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true);
    }
  });

  test("the RSS feed is well-formed and carries every entry", () => {
    const xml = whatsNewFeedXml("Test Site", "https://example.com");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    const entries = getWhatsNewEntries();
    expect((xml.match(/<item>/g) ?? []).length).toBe(entries.length);
    for (const entry of entries) {
      expect(xml).toContain(`https://example.com/whats-new#${entry.id}`);
    }
    // Every ampersand must be part of an entity — unescaped text breaks
    // strict feed readers.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    // pubDates are valid RFC 822 dates, never "Invalid Date".
    expect(xml).not.toContain("Invalid Date");
  });

  test("every entry is fully presentable", () => {
    for (const entry of getWhatsNewEntries()) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.project.trim().length).toBeGreaterThan(0);
      expect(entry.body.every((paragraph) => paragraph.trim().length > 0)).toBe(true);
      expect(formatAnnouncementDate(entry.date)).toMatch(/\w+ \d{1,2}, \d{4}/);
      if (entry.link) {
        expect(entry.link.href.startsWith("/") || entry.link.href.startsWith("https://")).toBe(true);
        // Descriptive link text is a build gate (a11y consult): no stock
        // phrases, and long enough to carry meaning out of context.
        expect(entry.link.label.toLowerCase()).not.toMatch(/^(click here|here|read more|learn more|more|link)$/);
        expect(entry.link.label.trim().length).toBeGreaterThanOrEqual(15);
      }
    }
  });

  test("a draft is validated but left off the page and the feed", () => {
    const entry = (id: string, extra: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({
      id, date: "2026-11-22", project: "Site", title: "A title", body: ["A paragraph."], ...extra,
    });
    const shown = publishedWhatsNewEntries([entry("2026-11-22-live"), entry("2026-11-22-held", { draft: true })]);
    expect(shown.map((item) => item.id)).toEqual(["2026-11-22-live"]);
    expect(() => publishedWhatsNewEntries([entry("2026-11-22-live"), entry("2026-11-22-held", { draft: true, body: [" "] })]))
      .toThrow(/non-empty body/);
    expect(() => publishedWhatsNewEntries([entry("2026-11-22-held", { draft: "yes" as unknown as boolean })]))
      .toThrow(/draft flag/);
  });

  test("the Mile Marker entry is held until the paper launches", () => {
    const all = (whatsNewData as { entries: WhatsNewEntry[] }).entries;
    expect(all.find((item) => item.id === "2026-11-22-the-mile-marker")?.draft).toBe(true);
    expect(getWhatsNewEntries().some((item) => item.id === "2026-11-22-the-mile-marker")).toBe(false);
    expect(whatsNewFeedXml("Test Site", "https://example.com")).not.toContain("the-mile-marker");
  });
});
