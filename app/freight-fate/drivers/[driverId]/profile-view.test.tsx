// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFateDriverProfile: getProfile,
  normalizeFreightFateDriverId: (value: string) => value,
}));

import { DriverProfileView, parseAchievementCursor, parseJournalCursor } from "./profile-view";

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
  recentAchievements: [
    { _id: "achievement-new", achievementKey: "clean_delivery", label: "Pretty as a Billboard", earnedAt: 1_800_000_000_000 },
    { _id: "achievement-old", achievementKey: "first_delivery", label: "Signed, Sealed, Hauled", earnedAt: 1_799_000_000_000 },
  ],
  achievements: [
    { _id: "achievement-new", achievementKey: "clean_delivery", label: "Pretty as a Billboard", earnedAt: 1_800_000_000_000 },
    { _id: "achievement-old", achievementKey: "first_delivery", label: "Signed, Sealed, Hauled", earnedAt: 1_799_000_000_000 },
  ],
  nextAchievementBefore: { sortAt: -1, achievementKey: "first_delivery" },
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
    expect(Array.from(document.querySelectorAll("h2"), (heading) => heading.textContent)).toEqual(["Current career", "Current career resume", "Achievements", "Road journal"]);
    const lists = document.querySelectorAll("dl");
    expect(lists).toHaveLength(2);
    for (const list of lists) for (const row of Array.from(list.children)) {
      expect(row.querySelectorAll(":scope > dt")).toHaveLength(1);
      expect(row.querySelectorAll(":scope > dd")).toHaveLength(1);
    }
    expect(lists[0].textContent).toContain("Career nameNorthbound Career");
    expect(lists[0].textContent).toContain("Career titleLeased-On Owner-Operator");
    expect(lists[0].textContent).toContain("EmploymentLeased-on owner-operator with Northstar Freight Lines");
    expect(lists[0].textContent).not.toContain("Employment or business identity");
    expect(lists[0].textContent).toContain("TractorRidgeline Sleeper (owned)");
    for (const label of ["Lifetime deliveries", "Lifetime miles", "On-time percentage", "Damage-free percentage", "Safety record", "States visited", "Cities visited", "Longest haul", "Lifetime career earnings", "Net worth"]) expect(lists[1].textContent).toContain(label);
    expect(lists[1].textContent).toContain("On-time percentage0%");
    expect(lists[1].textContent).toContain("Damage-free percentage0%");
    expect(document.body.textContent).not.toContain("Last saved location");
    expect(document.body.textContent).not.toContain("Overview");
    const safety = Array.from(lists[1].querySelectorAll("div")).find((row) => row.querySelector("dt")?.textContent === "Safety record")!;
    expect(safety.querySelectorAll(":scope > dd")).toHaveLength(1);
    expect(safety.querySelectorAll("dd > ul > li")).toHaveLength(7);
    expect(safety.textContent).toContain("1 citation");
    expect(safety.textContent).toContain("1 cargo claim");
    expect(safety.textContent).toContain("1 preventable equipment damage incident");
    expect(safety.textContent).not.toMatch(/1 citations|1 cargo claims|1 preventable equipment damage incidents/);
  });

  test("uses ordinary lists for newest canonical achievements and recent journal activity", async () => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    const headings = Array.from(document.querySelectorAll("h2"));
    const achievements = headings.find((node) => node.textContent === "Achievements")!.parentElement!;
    const journal = headings.find((node) => node.textContent === "Road journal")!.parentElement!;
    expect(achievements.textContent).toContain("4 achievements");
    expect(Array.from(achievements.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual([expect.stringContaining("Pretty as a Billboard"), expect.stringContaining("Signed, Sealed, Hauled")]);
    const firstAchievement = achievements.querySelector("ul > li")!;
    expect(Array.from(firstAchievement.children, (child) => [child.tagName, child.textContent])).toEqual([
      ["H3", "Pretty as a Billboard"],
      ["P", expect.stringMatching(/^Earned /)],
    ]);
    expect(firstAchievement.textContent).not.toContain("Pretty as a Billboard. Earned");
    expect(firstAchievement.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
    expect(Array.from(journal.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual([expect.stringContaining("Steel delivered safely."), expect.stringContaining("Reached level 18.")]);
    const firstJournalEntry = journal.querySelector("ul > li")!;
    expect(Array.from(firstJournalEntry.children, (child) => [child.tagName, child.textContent])).toEqual([
      ["H3", "delivery completed"],
      ["P", "Steel delivered safely."],
      ["P", expect.stringContaining("January")],
    ]);
    expect(firstJournalEntry.textContent).not.toContain("delivery completed. Steel delivered safely.");
    expect(firstJournalEntry.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
    expect(document.querySelector('[role="list"]')).toBeNull();
    expect(document.querySelector('[role="tab"]')).toBeNull();
    expect(document.querySelector(".sr-only")).toBeNull();
    expect(document.querySelector("section[aria-labelledby]")).toBeNull();
    const overviewLinks = document.querySelectorAll("section a");
    expect(overviewLinks.length).toBeGreaterThan(0);
    for (const link of overviewLinks) {
      expect(link.className).toContain("text-action");
      expect(link.className).toContain("underline");
    }
  });

  test("omits unavailable legacy facts without inventing values", async () => {
    getProfile.mockResolvedValue({ ...completeProfile, snapshot: { version: 1, level: 4, careerTitle: "Level 4 driver", deliveries: 12, milesDriven: 2_345, reputation: 80, capturedAt: 1_800_000_000_000 } });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    expect(Array.from(document.querySelectorAll("h2"), (node) => node.textContent)).toEqual(["Current career", "Current career resume", "Achievements", "Road journal"]);
    expect(document.body.textContent).toContain("Career titleLevel 4 driver");
    expect(document.body.textContent).not.toMatch(/Unknown|undefined|Net worth|Damage-free percentage/);
  });

  test("keeps no-snapshot and no-achievement profiles useful", async () => {
    getProfile.mockResolvedValue({ ...completeProfile, snapshot: null, achievementCount: 0, recentAchievements: [], achievements: [], nextAchievementBefore: null });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    expect(document.body.textContent).toContain("No current career has been shared yet.");
    expect(document.body.textContent).toContain("No current career resume has been shared yet.");
    expect(document.body.textContent).toContain("No achievements yet.");
  });

  test.each(["overview", "road-journal", "achievements"] as const)("marks only the current %s route", async (section) => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section })));
    const current = document.querySelectorAll('nav[aria-label="Freight Fate profile sections"] a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe(section === "overview" ? "/freight-fate/drivers/road-star-1234" : `/freight-fate/drivers/road-star-1234/${section}`);
    expect(document.querySelector("h1")?.getAttribute("tabindex")).toBe("-1");
  });

  test("shows a complete achievement page with undated imports and accessible pagination", async () => {
    getProfile.mockResolvedValue({
      ...completeProfile,
      achievementCount: 2,
      achievements: [
        completeProfile.achievements[0],
        { _id: "imported", achievementKey: "first_delivery", label: "Signed, Sealed, Hauled" },
      ],
      nextAchievementBefore: { sortAt: -1, achievementKey: "first_delivery" },
    });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "achievements" })));
    expect(document.body.textContent).toContain("2 achievements");
    expect(document.body.textContent).toContain("Signed, Sealed, Hauled");
    expect(document.body.textContent).not.toContain("Invalid Date");
    const pagination = document.querySelector('nav[aria-label="Achievements pagination"]')!;
    expect(pagination.querySelector("a")?.textContent).toBe("Older achievements");
  });

  test("uses concise achievement link wording", async () => {
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    const links = Array.from(document.querySelectorAll("a"))
      .filter((candidate) => candidate.getAttribute("href")?.endsWith("/achievements"));
    expect(links.map((link) => link.textContent)).toEqual(["Achievements", "View all achievements"]);
  });

  test("uses singular achievement wording", async () => {
    getProfile.mockResolvedValue({
      ...completeProfile, achievementCount: 1,
      recentAchievements: [completeProfile.recentAchievements[0]],
      achievements: [completeProfile.achievements[0]], nextAchievementBefore: null,
    });
    const overview = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    const shelf = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "achievements" })));
    expect(overview.body.textContent).toContain("1 achievement.");
    expect(shelf.body.textContent).toContain("1 achievement.");
    expect(overview.body.textContent).not.toContain("1 achievements");
  });

  test("displays public career statistics as whole numbers", async () => {
    getProfile.mockResolvedValue({
      ...completeProfile,
      snapshot: {
        ...completeProfile.snapshot!,
        milesDriven: 68_432.7,
        onTimeRate: 94.6,
        damageFreeRate: 89.8,
        longestHaulMiles: 1_842.4,
        reputation: 91.6,
      },
    });
    const document = documentFor(renderToStaticMarkup(await DriverProfileView({ driverId: "road-star-1234", section: "overview" })));
    const text = document.body.textContent ?? "";
    for (const expected of [
      "Lifetime miles68,433",
      "On-time percentage95%",
      "Damage-free percentage90%",
      "Longest haul1,842 miles",
      "Reputation92 out of 100",
    ]) expect(text).toContain(expected);
    expect(text).not.toMatch(/68,432\.7|94\.6%|89\.8%|1,842\.4 miles|91\.6 out of 100/);
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

  test("validates opaque achievement cursors", () => {
    expect(parseAchievementCursor("-1:first_delivery")).toEqual({ sortAt: -1, achievementKey: "first_delivery" });
    expect(parseAchievementCursor("bad")).toBeUndefined();
    expect(parseAchievementCursor("-2:first_delivery")).toBeUndefined();
  });
});
