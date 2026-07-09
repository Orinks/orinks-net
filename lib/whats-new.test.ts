import { describe, expect, test } from "vitest";
import { formatAnnouncementDate, getWhatsNewEntries } from "./whats-new";

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
});
