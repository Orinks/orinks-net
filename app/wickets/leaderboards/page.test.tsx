// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { choiceFrom } from "@/lib/wickets-leaderboards/choice";
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
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("on the production site", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "production"));

  test("the page and the old game pages are not found", async () => {
    await expect(WicketsLeaderboardsPage()).rejects.toThrow(NOT_FOUND);
    await expect(WicketsGameLeaderboardsPage({ params: Promise.resolve({ game: "belfry" }) })).rejects.toThrow(
      NOT_FOUND,
    );
  });
});

describe("on the preview", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "preview"));

  test("one page: a game picker, board buttons, and the first game's daily board", async () => {
    await page();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Wicket's Leaderboards"]);
    const select = screen.getByRole("combobox", { name: "Game" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
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
    expect(metadata.robots).toEqual({ index: false });
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
      game: "safecracker",
      period: "daily",
      pace: "main",
    });
    await page({ game: "riverboat-dice", board: "monthly" });
    expect(screen.getByRole("table", { name: "Riverboat Dice, this month" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Pace" })).toBeNull();
  });

  test("the buttons and the picker change the board in place, and the address follows", async () => {
    await page();
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
