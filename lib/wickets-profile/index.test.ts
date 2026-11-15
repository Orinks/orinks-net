import { describe, expect, it } from "vitest";
import { memoryRecords } from "@/lib/wickets-online";
import { pageFrom, readPlayerPage } from "./index";

const NOW = Date.UTC(2026, 11, 26);

describe("a player's page", () => {
  it("lists ranked bests per game and pace, and leaves out games with none", () => {
    const page = pageFrom(
      "Ada",
      {
        name: "Ada",
        ranked: [
          { game: "safecracker", period: "weekly", relaxed: false, score: 50 },
          { game: "safecracker", period: "daily", relaxed: true, score: 9 },
          { game: "belfry", period: "monthly", relaxed: false, score: 7 },
        ],
        card: null,
      },
      {},
      NOW,
    );
    expect(page.ranked).toEqual([
      { label: "Safecracker", daily: null, weekly: 50, monthly: null },
      { label: "Safecracker, Relaxed pace", daily: 9, weekly: null, monthly: null },
      { label: "Belfry", daily: null, weekly: null, monthly: 7 },
    ]);
    expect(page.specials).toEqual([]);
    expect(page.fromGame).toEqual([]);
  });

  it("names a special only from the specials list, once its date has come", () => {
    const card = { v: 1 as const, games: {}, specials: ["early", "open", "unknown"] };
    const page = pageFrom(
      "Ada",
      { name: "Ada", ranked: [], card },
      { early: { name: "Not Yet", showFrom: NOW + 1 }, open: { name: "Out Now", showFrom: NOW - 1 } },
      NOW,
    );
    expect(page.specials).toEqual(["Out Now"]);
  });

  it("shows the game's numbers only for released games, by name", () => {
    const card = {
      v: 1 as const,
      games: { belfry: { best: 40, unlocks: 3 }, larkfield: { unlocks: 2 }, "not-out-yet": { best: 1 } },
      specials: [],
    };
    const page = pageFrom("Ada", { name: "Ada", ranked: [], card }, {}, NOW);
    expect(page.fromGame).toEqual([
      { name: "Belfry", best: 40, unlocks: 3 },
      { name: "Larkfield", best: null, unlocks: 2 },
    ]);
  });

  it("reads the boards, the card and the specials list from the records", async () => {
    const records = memoryRecords();
    await records.put("card", "p1", { value: { v: 1, games: { belfry: { best: 4 } }, specials: ["s1"] }, playerId: "p1" });
    await records.put("catalog", "s1", { value: { name: "A Special", showFrom: 0 } });
    const page = await readPlayerPage(records, { playerId: "p1", name: "Ada" }, NOW);
    expect(page.specials).toEqual(["A Special"]);
    expect(page.fromGame).toEqual([{ name: "Belfry", best: 4, unlocks: null }]);
  });
});
