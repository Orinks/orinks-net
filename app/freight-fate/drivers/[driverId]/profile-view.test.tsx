// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFateDriverProfile: getProfile,
  normalizeFreightFateDriverId: (value: string) => value,
}));

import { DriverProfileView, parseJournalCursor } from "./profile-view";

const privateSentinels = [
  "CASH-PRIVATE-9182", "CREDIT-PRIVATE-3817", "LOCATION-PRIVATE-4921",
  "CARGO-PRIVATE-7241", "CUSTOMER-PRIVATE-8173", "VALUE-PRIVATE-9127",
  "DESTINATION-PRIVATE-1278", "FATIGUE-PRIVATE-2819", "HOS-PRIVATE-3912",
  "DISPATCHER-PRIVATE-4812",
];

const completeProfile = {
  driver: { driverId: "road-star-1234", displayName: "Road Star", visibility: "public" },
  presence: null,
  snapshot: {
    version: 1, saveName: "Northbound Career", businessStatus: "leased_owner_operator",
    businessIdentity: "Leased-on owner-operator with Northstar Freight Lines",
    carrierName: "Northstar Freight Lines", level: 18,
    careerTitle: "Leased-On Owner-Operator", truckName: "Ridgeline Sleeper",
    truckIsCarrierAssigned: false, deliveries: 100, milesDriven: 80_000,
    reputation: 92, onTimeRate: 0, damageFreeRate: 0,
    safetyRecord: { citations: 1, seriousViolations: 0, majorOffenses: 0, fatigueEvents: 2, cargoClaims: 1, preventableEquipmentDamage: 1, carrierTerminations: 0, repossessions: 0 },
    citiesVisited: 120, statesVisited: 35, longestHaulMiles: 1_400,
    lifetimeEarnings: 750_000, netWorth: 186_000, netWorthComplete: true,
    capturedAt: 1_800_000_000_000,
  },
  events: [
    { _id: "event-new", eventId: "delivery-12", eventType: "delivery_completed", summary: "Steel delivered safely.", occurredAt: 1_800_000_000_000 },
    { _id: "event-old", eventId: "delivery-11", eventType: "level_earned", summary: "Reached level 18.", occurredAt: 1_799_000_000_000 },
  ],
  achievementCount: 4,
  achievements: [
    { _id: "achievement-new", achievementKey: "clean_delivery", label: "Pretty as a Billboard", earnedAt: 1_800_000_000_000 },
    { _id: "achievement-old", achievementKey: "first_delivery", label: "Signed, Sealed, Hauled", earnedAt: 1_799_000_000_000 },
  ],
  nextBefore: { occurredAt: 1_799_000_000_000, eventId: "delivery-11" },
  privateSentinels,
};

function documentFor(markup: string) {
  const parsed = document.implementation.createHTMLDocument();
  parsed.body.innerHTML = markup;
  return parsed;
}

describe("driver profile routes", () => {
  beforeEach(() => getProfile.mockResolvedValue(completeProfile));

  test("renders the identity-first overview with ordered semantic sections and facts", async () => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    expect(Array.from(document.querySelectorAll("h1"), (heading) => heading.textContent)).toEqual(["Road Star"]);
    expect(Array.from(document.querySelectorAll("h2"), (heading) => heading.textContent)).toEqual(["Current career", "Current career resume", "Account-wide achievements", "Road journal"]);
    const lists = document.querySelectorAll("dl");
    expect(lists).toHaveLength(2);
    for (const list of lists) for (const row of Array.from(list.children)) {
      expect(row.querySelectorAll(":scope > dt")).toHaveLength(1);
      expect(row.querySelectorAll(":scope > dd")).toHaveLength(1);
    }
    expect(lists[0].textContent).toContain("Career nameNorthbound Career");
    expect(lists[0].textContent).toContain("Career titleLeased-On Owner-Operator");
    expect(lists[0].textContent).toContain("TractorRidgeline Sleeper (owned)");
    for (const label of ["Lifetime deliveries", "Lifetime miles", "On-time percentage", "Damage-free percentage", "Safety record", "States visited", "Cities visited", "Longest haul", "Lifetime career earnings", "Net worth"]) expect(lists[1].textContent).toContain(label);
    expect(lists[1].textContent).toContain("On-time percentage0%");
    expect(lists[1].textContent).toContain("Damage-free percentage0%");
    expect(document.body.textContent).not.toContain("Last saved location");
    expect(document.body.textContent).not.toContain("Overview");
  });

  test("uses ordinary lists for newest canonical achievements and recent journal activity", async () => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    const headings = Array.from(document.querySelectorAll("h2"));
    const achievements = headings.find((node) => node.textContent === "Account-wide achievements")!.parentElement!;
    const journal = headings.find((node) => node.textContent === "Road journal")!.parentElement!;
    expect(achievements.textContent).toContain("4 account-wide achievements");
    expect(Array.from(achievements.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual([expect.stringContaining("Pretty as a Billboard"), expect.stringContaining("Signed, Sealed, Hauled")]);
    expect(Array.from(journal.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual([expect.stringContaining("Steel delivered safely."), expect.stringContaining("Reached level 18.")]);
    expect(document.querySelector('[role="list"]')).toBeNull();
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(document.querySelector(".sr-only")).toBeNull();
    expect(document.querySelector("section[aria-labelledby]")).toBeNull();
  });

  test("omits unavailable legacy facts without inventing values", async () => {
    getProfile.mockResolvedValue({ ...completeProfile, snapshot: { version: 1, level: 4, careerTitle: "Level 4 driver", deliveries: 12, milesDriven: 2_345, reputation: 80, capturedAt: 1_800_000_000_000 } });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    expect(Array.from(document.querySelectorAll("h2"), (node) => node.textContent)).toEqual(["Current career", "Current career resume", "Account-wide achievements", "Road journal"]);
    expect(document.body.textContent).toContain("Career titleLevel 4 driver");
    expect(document.body.textContent).not.toMatch(/Unknown|undefined|Net worth|Damage-free percentage/);
  });

  test("keeps no-snapshot and no-achievement profiles useful", async () => {
    getProfile.mockResolvedValue({ ...completeProfile, snapshot: null, achievementCount: 0, achievements: [] });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    expect(document.body.textContent).toContain("No current career has been shared yet.");
    expect(document.body.textContent).toContain("No current career resume has been shared yet.");
    expect(document.body.textContent).toContain("No account-wide achievements yet.");
  });

  test.each(["overview", "road-journal", "achievements"] as const)("marks only the current %s route", async (section) => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section })));
    const current = document.querySelectorAll('nav[aria-label="Freight Fate profile sections"] a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe(section === "overview" ? "/freight-fate/drivers/road-star-1234" : `/freight-fate/drivers/road-star-1234/${section}`);
  });

  test("uses an identical non-leaking unavailable presentation", async () => {
    getProfile.mockResolvedValue(null);
    const html = renderToStaticMarkup(await DriverProfileView({ driverId: "private-driver-secret", section: "overview" }));
    expect(html).toContain("Freight Fate Profile Unavailable");
    expect(html).not.toContain("private-driver-secret");
    expect(html).not.toContain("Road Star");
    for (const sentinel of privateSentinels) expect(html).not.toContain(sentinel);
  });

  test("never renders recurring fiction disclaimers or prohibited operational details", async () => {
    const html = renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" }));
    expect(html.toLowerCase()).not.toMatch(/this is (?:a )?(?:fiction|game)|fictional/);
    for (const sentinel of privateSentinels) expect(html).not.toContain(sentinel);
  });

  test("validates opaque journal cursors", () => {
    expect(parseJournalCursor("1800000000000:delivery-12")).toEqual({ occurredAt: 1_800_000_000_000, eventId: "delivery-12" });
    expect(parseJournalCursor("bad")).toBeUndefined();
  });
});
