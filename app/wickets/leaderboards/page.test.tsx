// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import WicketsLeaderboardsPage, { metadata } from "./page";
import WicketsGameLeaderboardsPage, { generateMetadata } from "./[game]/page";

function documentFor(markup: string) {
  const parsed = document.implementation.createHTMLDocument();
  parsed.body.innerHTML = markup;
  return parsed;
}

async function gamePage(game: string) {
  return documentFor(renderToStaticMarkup(await WicketsGameLeaderboardsPage({ params: Promise.resolve({ game }) })));
}

function texts(nodes: Iterable<Element>) {
  return Array.from(nodes, (node) => node.textContent);
}

/** What notFound() throws, so a test can tell a 404 from any other failure. */
const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday, November 13, 2026, 15:30 UTC.
  vi.setSystemTime(Date.UTC(2026, 10, 13, 15, 30));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("on the production site", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "production"));

  test("both pages are not found", async () => {
    expect(() => WicketsLeaderboardsPage()).toThrow(NOT_FOUND);
    await expect(gamePage("safecracker")).rejects.toThrow(NOT_FOUND);
  });
});

describe("on the preview", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", "preview"));

  test("the index links each ranked game, and is not indexed", () => {
    const page = documentFor(renderToStaticMarkup(<WicketsLeaderboardsPage />));
    expect(texts(page.querySelectorAll("h1"))).toEqual(["Wicket's Leaderboards"]);
    expect(page.querySelector("header p:last-child")?.textContent).toBe("Sample scores.");
    expect(Array.from(page.querySelectorAll("li a"), (a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Safecracker", "/wickets/leaderboards/safecracker"],
      ["Belfry", "/wickets/leaderboards/belfry"],
      ["Fireside Patience", "/wickets/leaderboards/fireside-patience"],
      ["Riverboat Dice", "/wickets/leaderboards/riverboat-dice"],
      ["Sonar Dive", "/wickets/leaderboards/sonar-dive"],
    ]);
    expect(metadata.robots).toEqual({ index: false });
  });

  test("an unknown game is not found", async () => {
    await expect(gamePage("lantern-lake")).rejects.toThrow(NOT_FOUND);
  });

  test("a game has one heading per period and a captioned table for each board", async () => {
    const page = await gamePage("riverboat-dice");
    expect(texts(page.querySelectorAll("h1"))).toEqual(["Riverboat Dice Leaderboards"]);
    expect(texts(page.querySelectorAll("h2"))).toEqual(["Today", "This week", "This month"]);
    expect(page.querySelectorAll("h3")).toHaveLength(0);
    const tables = Array.from(page.querySelectorAll("table"));
    expect(tables.map((table) => table.querySelector("caption")?.textContent)).toEqual([
      "Daily challenge",
      "Weekly challenge",
      "Monthly challenge",
    ]);
    for (const table of tables) {
      expect(texts(table.querySelectorAll("thead th[scope=col]"))).toEqual(["Rank", "Player", "Score"]);
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      expect(rows.map((row) => row.querySelector("td")?.textContent)).toEqual(rows.map((_, i) => String(i + 1)));
      expect(rows.every((row) => row.querySelector("th[scope=row]"))).toBe(true);
    }
    expect(page.body.textContent).not.toMatch(/mock|preview/i);
    expect((await generateMetadata({ params: Promise.resolve({ game: "riverboat-dice" }) })).robots).toEqual({
      index: false,
    });
  });

  test("each board says how many players it has and when it ends", async () => {
    const page = await gamePage("riverboat-dice");
    const lines = Array.from(page.querySelectorAll("h2 + div > p, section p"))
      .map((p) => p.textContent)
      .filter((text) => text?.includes("Ends"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Top 10 of \d+ players\. Ends Saturday, November 14, 00:00 UTC\.$/);
    expect(lines[1]).toMatch(/Ends Monday, November 16, 00:00 UTC\.$/);
    expect(lines[2]).toMatch(/Ends Tuesday, December 1, 00:00 UTC\.$/);
    expect(Array.from(page.querySelectorAll("time"), (time) => time.getAttribute("datetime"))).toEqual([
      "2026-11-14T00:00:00.000Z",
      "2026-11-16T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ]);
  });

  test("a game with a Relaxed pace board keeps it apart under each period", async () => {
    const page = await gamePage("safecracker");
    expect(texts(page.querySelectorAll("h1"))).toEqual(["Safecracker Leaderboards"]);
    expect(texts(page.querySelectorAll("h3"))).toEqual(
      Array(3).fill(["Normal and Quick pace", "Relaxed pace"]).flat(),
    );
    expect(texts(page.querySelectorAll("caption"))).toEqual([
      "Daily challenge, Normal and Quick pace",
      "Daily challenge, Relaxed pace",
      "Weekly challenge, Normal and Quick pace",
      "Weekly challenge, Relaxed pace",
      "Monthly challenge, Normal and Quick pace",
      "Monthly challenge, Relaxed pace",
    ]);
    expect(page.body.textContent).toContain("7 players. Ends Saturday, November 14, 00:00 UTC.");
  });

  test("an empty board says so in one sentence instead of a table", async () => {
    const page = await gamePage("belfry");
    const today = page.querySelector("section")!;
    expect(today.querySelector("h2")?.textContent).toBe("Today");
    expect(today.querySelector("table")).toBeNull();
    expect(today.querySelector("p")?.textContent).toBe("No scores yet. Ends Saturday, November 14, 00:00 UTC.");
    expect(page.querySelectorAll("table")).toHaveLength(2);
  });
});
