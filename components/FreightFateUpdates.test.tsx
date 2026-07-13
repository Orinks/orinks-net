import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const { getUpdates } = vi.hoisted(() => ({ getUpdates: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({ getFreightFatePublicUpdates: getUpdates }));
import { FreightFateUpdates, parseUpdatesCursor } from "./FreightFateUpdates";

test("renders the public feed as a labeled newest-first ordered list", async () => {
  getUpdates.mockResolvedValue({
    updates: [
      { _id: "row", driverId: "road-star-1234", displayName: "Road Star", eventId: "delivery #12?", eventType: "delivery_completed", summary: "Delivered steel from Chicago to Denver.", occurredAt: 1_800_000_000_000 },
      { _id: "row-2", driverId: "other-driver-1234", displayName: "Other Driver", eventId: "delivery #12?", eventType: "delivery_completed", summary: "Delivered produce in summer.", occurredAt: 1_781_517_600_000 },
    ],
    nextBefore: { occurredAt: 1_800_000_000_000, eventId: "delivery-12" },
  });
  const html = renderToStaticMarkup(await FreightFateUpdates({ limit: 20 }));
  expect(html).toContain('<section aria-labelledby="freight-fate-updates-heading"');
  expect(html).toContain("<ol");
  expect(html).toContain('dateTime="2027-01-15T08:00:00.000Z"');
  expect(html).toContain("EST");
  expect(html).toContain("EDT");
  expect(html).toContain("Older updates");
  expect(html).toMatch(/aria-labelledby="update-event-[A-Za-z0-9_-]+"/);
  expect(html).not.toContain("delivery #12?");
  expect(new Set([...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1])).size).toBe(3);
  expect(html).not.toContain("aria-live");
  expect(html).not.toContain('role="feed"');
  expect(html).toContain("Newest updates first.");
  expect(html).not.toContain("Factual public in-game activity");
});

test("validates public feed cursors", () => {
  expect(parseUpdatesCursor("1800000000000:delivery-12")).toEqual({ occurredAt: 1_800_000_000_000, eventId: "delivery-12" });
  expect(parseUpdatesCursor("not-a-cursor")).toBeUndefined();
});

test("renders the compact feed as a closed native disclosure", async () => {
  getUpdates.mockResolvedValue({
    updates: [{ _id: "compact-row", driverId: "road-star-1234", displayName: "Road Star", eventId: "delivery-compact", eventType: "delivery_completed", summary: "Delivered steel.", occurredAt: 1_800_000_000_000 }],
    nextBefore: undefined,
  });
  const html = renderToStaticMarkup(await FreightFateUpdates({ compact: true, limit: 5 }));
  expect(html).toContain('<section aria-labelledby="public-driver-updates-heading"');
  expect(html).toContain('<h2 class="mb-4 text-2xl font-bold text-ink" id="public-driver-updates-heading">Driver updates</h2><details');
  expect(html).toContain("<details");
  expect(html).not.toContain("<details open");
  expect(html).toContain("<summary");
  expect(html).toContain("Freight Fate updates");
  expect(html).not.toContain("Public Freight Fate updates");
  expect(html).toContain("focus-visible:ring-4");
  expect(html).not.toMatch(/<summary[^>]*>\s*<h[1-6]/);
  expect(html).toContain("<h3");
  expect(html).toContain('<time dateTime="2027-01-15T08:00:00.000Z">');
  expect(html).toContain("EST");
  expect(html).not.toContain("aria-expanded");
  expect(html).not.toContain("renewed sharing consent");
});
