import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => ({ query: mocks.query }),
}));

import { getStationNewsEntries, stationNewsEntries, type StationNews } from "./whats-new-stations";
import { getWhatsNewEntries, mergeWhatsNewEntries, whatsNewFeedXml } from "./whats-new";

// 9 PM in New York on October 20 is already October 21 in UTC; the owner's
// evening review belongs to the 20th.
const OCT_20_EVENING = Date.parse("2026-10-21T01:00:00Z");
const OCT_20_MORNING = Date.parse("2026-10-20T14:00:00Z");
const OCT_18 = Date.parse("2026-10-18T18:00:00Z");

const river: StationNews = {
  name: "The River",
  kind: "terrestrial",
  acceptedAt: OCT_20_EVENING,
  callSign: "WXRV",
  frequency: "92.5 FM",
  city: "Haverhill",
  state: "Massachusetts",
};
const paradise: StationNews = {
  name: "Radio Paradise",
  kind: "web",
  acceptedAt: OCT_20_MORNING,
  genre: "eclectic rock",
};
const kexp: StationNews = { name: "KEXP", kind: "terrestrial", acceptedAt: OCT_18, callSign: "KEXP", state: "Washington" };

beforeEach(() => mocks.query.mockReset());

describe("station announcements", () => {
  test("one entry per day the owner accepted stations, newest first", () => {
    const entries = stationNewsEntries([kexp, river, paradise]);
    expect(entries.map((entry) => entry.id)).toEqual([
      "2026-10-20-new-radio-stations",
      "2026-10-18-new-radio-stations",
    ]);
    expect(entries[0]).toMatchObject({
      date: "2026-10-20",
      project: "Freight Fate",
      title: "Radio Paradise and The River join Freight Fate's radio",
      body: [
        "Radio Paradise, an online station playing eclectic rock.",
        "The River, WXRV 92.5 FM, from Haverhill, Massachusetts.",
        "They are on the dial the next time you start the game.",
      ],
      link: { href: "/freight-fate/suggest-a-station", label: "Suggest a radio station" },
    });
  });

  test("a single station is named, its call sign not repeated, and a big day is counted", () => {
    const [single] = stationNewsEntries([kexp]);
    expect(single.title).toBe("KEXP joins Freight Fate's radio");
    expect(single.body).toEqual(["KEXP, from Washington.", "It is on the dial the next time you start the game."]);

    const many = stationNewsEntries([river, paradise, { ...kexp, acceptedAt: OCT_20_MORNING }]);
    expect(many[0].title).toBe("3 new stations join Freight Fate's radio");
  });

  test("generated entries pass the curated checks and reach the page order and the feed", () => {
    const curated = getWhatsNewEntries();
    const merged = mergeWhatsNewEntries(curated, stationNewsEntries([river, kexp]));
    expect(merged).toHaveLength(curated.length + 2);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1].date >= merged[i].date).toBe(true);
    }
    const xml = whatsNewFeedXml("Test Site", "https://example.com", merged);
    expect(xml).toContain("https://example.com/whats-new#2026-10-20-new-radio-stations");
    expect(xml).toContain("Freight Fate&apos;s radio");
  });

  test("an id a curated entry already uses is left out", () => {
    const curated = getWhatsNewEntries();
    const clash = { ...stationNewsEntries([kexp])[0], id: curated[0].id };
    expect(mergeWhatsNewEntries(curated, [clash])).toHaveLength(curated.length);
  });

  test("an unreachable backend leaves the curated page alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.query.mockRejectedValueOnce(new Error("no such function"));
    expect(await getStationNewsEntries()).toEqual([]);
    mocks.query.mockResolvedValueOnce([kexp]);
    expect((await getStationNewsEntries()).map((entry) => entry.id)).toEqual(["2026-10-18-new-radio-stations"]);
  });
});
