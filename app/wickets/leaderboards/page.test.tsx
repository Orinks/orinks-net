// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { choiceFrom } from "@/lib/wickets-leaderboards/choice";
import type { WicketsBoardSource } from "@/lib/wickets-leaderboards";

const live = vi.hoisted(() => ({ source: null as WicketsBoardSource | null, asked: [] as string[] }));
vi.mock("@/lib/wickets-leaderboards/live", () => ({ liveBoards: () => live.source }));
import WicketsLeaderboardsPage, { metadata } from "./page";
import WicketsGameLeaderboardsPage from "./[game]/page";

/** What notFound() and redirect() throw, so a test can tell them apart. */
const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });
const REDIRECT = (to: string) => expect.objectContaining({ digest: expect.stringContaining(to) });

async function page(search: Record<string, string | string[]> = {}) {
  render(await WicketsLeaderboardsPage({ searchParams: Promise.resolve(search) }));
}

function pressed(group: string) {
  return within(screen.getByRole("group", { name: group }))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday, November 13, 2026, 15:30 UTC.
  vi.setSystemTime(Date.UTC(2026, 10, 13, 15, 30));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  live.source = null;
  live.asked = [];
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("on the live site", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "production"));

  test("with no backend, the page says the boards are unavailable", async () => {
    await page();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Wicket's Leaderboards");
    expect(document.body.textContent).toContain("The leaderboards are unavailable right now. Try again later.");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("reads only the board shown, then the others from the service as they are chosen", async () => {
    live.source = {
      async board(game, period, pace) {
        live.asked.push(`${game}-${period}-${pace}`);
        return {
          key: "2026-11-13",
          endsAt: Date.UTC(2026, 10, 14),
          entries: [{ rank: 1, name: "Copper Fox 12", score: 640 }],
          of: 1,
        };
      },
    };
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        return new Response(
          JSON.stringify({
            key: "2026-W46",
            current: true,
            entries: [
              { rank: 1, name: "TinLantern", score: 900 },
              { rank: 2, name: "Quiet Wren 4", score: 410 },
            ],
            of: 2,
            you: null,
          }),
        );
      }),
    );
    await page({ game: "belfry" });
    expect(live.asked).toEqual(["belfry-daily-main"]);
    expect(document.body.textContent).not.toContain("Sample scores.");
    expect(document.body.textContent).toContain("1 player. Ends Saturday, November 14, 00:00 UTC.");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(document.body.textContent).toContain("Reading the scores…");
    expect(await screen.findByRole("table", { name: "Belfry, this week" })).toBeInTheDocument();
    expect(fetched).toEqual(["/api/games/wickets/belfry-weekly/top"]);
    expect(document.body.textContent).toContain("2 players. Ends Monday, November 16, 00:00 UTC.");
  });

  test("the overview reads every game's main board and ranks players by place", async () => {
    const scores: Record<string, { name: string; score: number }[]> = {
      safecracker: [
        { name: "Copper Fox 12", score: 12000 },
        { name: "TinLantern", score: 9000 },
      ],
      belfry: [{ name: "TinLantern", score: 300 }],
    };
    live.source = {
      async board(game, period, pace) {
        live.asked.push(`${game}-${period}-${pace}`);
        const entries = (scores[game] ?? []).map((e, i) => ({ rank: i + 1, ...e }));
        return { key: "2026-11-13", endsAt: Date.UTC(2026, 10, 14), entries, of: entries.length };
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await page();
    expect(live.asked).toEqual([
      "safecracker-daily-main",
      "belfry-daily-main",
      "fireside-patience-daily-main",
      "riverboat-dice-daily-main",
      "sonar-dive-daily-main",
    ]);
    const rows = within(screen.getByRole("table", { name: "All games, today" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "1TinLantern191st in Belfry, 2nd in Safecracker",
      "2Copper Fox 12101st in Safecracker",
    ]);
    expect(document.body.textContent).toContain("2 players. Ends Saturday, November 14, 00:00 UTC.");
  });

  test("a board the service cannot answer says so", async () => {
    live.source = {
      async board() {
        return { key: "k", endsAt: Date.UTC(2026, 10, 14), entries: [], of: 0 };
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await page({ game: "sonar-dive" });
    expect(document.body.textContent).toContain("No scores yet. Ends Saturday, November 14, 00:00 UTC.");
    fireEvent.click(screen.getByRole("button", { name: "Relaxed" }));
    expect(await screen.findByText("The scores could not be read. Try again later.")).toBeInTheDocument();
  });
});

describe("on the preview", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "preview"));

  test("opens on today's overview of all games", async () => {
    await page();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Wicket's Leaderboards"]);
    const select = screen.getByRole("combobox", { name: "Game" });
    expect(select).toHaveValue("all");
    expect(pressed("Board")).toEqual(["Today"]);
    expect(screen.queryByRole("group", { name: "Pace" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("All games, today");
    const table = screen.getByRole("table", { name: "All games, today" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Rank",
      "Player",
      "Points",
      "Places",
    ]);
    expect(document.body.textContent).toContain("Points for each game's place: 10 for first, down to 1 for tenth.");
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    expect(document.body.textContent).toMatch(/Top 10 of \d+ players\. Ends Saturday, November 14, 00:00 UTC\./);
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getAllByRole("cell")[0]).toHaveTextContent("1");
    expect(within(first).getAllByRole("cell")[2].textContent).toMatch(/^(1st|2nd|3rd|\d+th) in /);
  });

  test("one page: a game picker, board buttons, and a game's daily board", async () => {
    await page({ game: "safecracker" });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Wicket's Leaderboards"]);
    const select = screen.getByRole("combobox", { name: "Game" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All games",
      "Safecracker",
      "Belfry",
      "Fireside Patience",
      "Riverboat Dice",
      "Sonar Dive",
    ]);
    expect(select).toHaveValue("safecracker");
    expect(pressed("Board")).toEqual(["Today"]);
    expect(pressed("Pace")).toEqual(["Normal and Quick"]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Safecracker, today");
    const table = screen.getByRole("table", { name: "Safecracker, today" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Rank", "Player", "Score"]);
    expect(document.body.textContent).toContain("Top 10 of 39 players. Ends Saturday, November 14, 00:00 UTC.");
    expect(document.body.textContent).not.toMatch(/mock|preview/i);
    expect(metadata.title).toBe("Wicket's Leaderboards");
  });

  test("the address chooses the board, and a form without scripts takes the pressed button's", async () => {
    expect(choiceFrom({ game: "sonar-dive", board: "weekly", pace: "relaxed" })).toEqual({
      game: "sonar-dive",
      period: "weekly",
      pace: "relaxed",
    });
    expect(choiceFrom({ game: "belfry", board: ["daily", "monthly"], pace: "relaxed" })).toEqual({
      game: "belfry",
      period: "monthly",
      pace: "main",
    });
    expect(choiceFrom({ game: "lantern-lake", board: "yearly" })).toEqual({
      game: "all",
      period: "daily",
      pace: "main",
    });
    await page({ game: "riverboat-dice", board: "monthly" });
    expect(screen.getByRole("table", { name: "Riverboat Dice, this month" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Pace" })).toBeNull();
  });

  test("the buttons and the picker change the board in place, and the address follows", async () => {
    await page({ game: "safecracker" });
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(pressed("Board")).toEqual(["This week"]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Safecracker, this week");
    fireEvent.click(screen.getByRole("button", { name: "Relaxed" }));
    expect(screen.getByRole("table", { name: "Safecracker, this week, Relaxed pace" })).toBeInTheDocument();
    expect(window.location.search).toBe("?game=safecracker&board=weekly&pace=relaxed");
    fireEvent.change(screen.getByRole("combobox", { name: "Game" }), { target: { value: "fireside-patience" } });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Fireside Patience, this week");
    expect(screen.queryByRole("group", { name: "Pace" })).toBeNull();
    expect(window.location.search).toBe("?game=fireside-patience&board=weekly");
    fireEvent.change(screen.getByRole("combobox", { name: "Game" }), { target: { value: "all" } });
    expect(screen.getByRole("table", { name: "All games, this week" })).toBeInTheDocument();
    expect(window.location.search).toBe("?board=weekly");
  });

  test("an empty board says so in one sentence instead of a table", async () => {
    await page({ game: "belfry" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Belfry, today");
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).toContain("No scores yet. Ends Saturday, November 14, 00:00 UTC.");
  });

  test("an old game page goes to that game on the one page", async () => {
    await expect(WicketsGameLeaderboardsPage({ params: Promise.resolve({ game: "sonar-dive" }) })).rejects.toThrow(
      REDIRECT("/wickets/leaderboards?game=sonar-dive"),
    );
    await expect(WicketsGameLeaderboardsPage({ params: Promise.resolve({ game: "lantern-lake" }) })).rejects.toThrow(
      NOT_FOUND,
    );
  });
});
