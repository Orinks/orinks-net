import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFateDriverProfile: getProfile,
  normalizeFreightFateDriverId: (value: string) => value,
}));

import { DriverProfileView, parseJournalCursor } from "./profile-view";

const profile = {
  driver: { driverId: "road-star-1234", displayName: "Road Star", visibility: "public" },
  presence: null,
  snapshot: { version: 1, level: 4, careerTitle: "Level 4 driver", lastSavedCity: "Chicago, Illinois", deliveries: 12, milesDriven: 2345, reputation: 80, capturedAt: 1_800_000_000_000 },
  events: [{ _id: "event-row", eventId: "delivery-12", eventType: "delivery_completed", summary: "Steel delivered from Chicago to Denver.", occurredAt: 1_800_000_000_000 }],
  achievements: [{ _id: "achievement-row", name: "First delivery", description: "Complete a delivery.", earnedAt: 1_800_000_000_000 }],
  nextBefore: { occurredAt: 1_800_000_000_000, eventId: "delivery-12" },
};

describe("driver profile routes", () => {
  beforeEach(() => getProfile.mockResolvedValue(profile));

  test.each([
    ["overview", "<dl", "Overview"],
    ["road-journal", "<ol", "Road journal"],
    ["achievements", "<ul", "Achievements"],
  ] as const)("renders accessible %s semantics", async (section, structure, heading) => {
    const html = renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section }));
    expect((html.match(/<h1/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
    expect(html).toContain(`<h2`);
    expect(html).toContain(heading);
    expect(html).toContain(structure);
    expect(html).toContain('dateTime="2027-01-15T08:00:00.000Z"');
    expect(html).toContain("EST");
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain("A Freight Fate driver profile shared through orinks.net.");
    expect(html).not.toContain("Shared profiles may appear in discovery.");
  });

  test("uses an identical non-leaking unavailable presentation", async () => {
    getProfile.mockResolvedValue(null);
    const html = renderToStaticMarkup(await DriverProfileView({ driverId: "private-driver-secret", section: "overview" }));
    expect(html).toContain("Freight Fate Profile Unavailable");
    expect(html).not.toContain("private-driver-secret");
    expect(html).not.toContain("Road Star");
  });

  test("explains when verified career statistics are not available", async () => {
    getProfile.mockResolvedValue({ ...profile, snapshot: null });
    const html = renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" }));
    expect(html).toContain("No server-verified career statistics are available yet.");
    expect(html).not.toContain("No shared profile snapshot is available yet.");
  });

  test("validates opaque journal cursors", () => {
    expect(parseJournalCursor("1800000000000:delivery-12")).toEqual({ occurredAt: 1_800_000_000_000, eventId: "delivery-12" });
    expect(parseJournalCursor("bad")).toBeUndefined();
  });
});
