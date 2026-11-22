import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) =>
    (...args: Args) => callback(...args),
}));
vi.mock("@/lib/convex", () => ({ getConvexClient: () => null }));

import { renderPaperStory, type PaperStory } from "./freight-fate-paper";
import {
  PAPER_CHROME,
  PAPER_NAME,
  fixtureEdition,
  fixtureListings,
  gameNewsFromReleases,
  paperFeedXml,
  releaseVersion,
} from "./freight-fate-paper-page";
import {
  buildPaperView,
  earlierIssues,
  frontPageHeadlines,
  paperIssueLabel,
  paperPeriodDays,
  paperRecordResult,
  sinceMondaySentence,
  storySegments,
} from "./freight-fate-paper-view";
import type { GitHubRelease } from "./github";

const names = new Map([["dana-rig", "Dana Rig"], ["lee-ann", "Lee Ann"]]);

function story(kind: string, driverIds: string[], facts: PaperStory["facts"], variant = 0): PaperStory {
  return { id: `${kind}.test`, section: "driver_news", kind, driverIds, facts, variant, rank: 10 };
}

function release(tag: string, published: string, prerelease = false): GitHubRelease {
  return {
    tag_name: tag, name: null, body: null, prerelease, assets: [],
    html_url: `https://github.com/orinks-games/Freight-Fate/releases/tag/${tag}`, published_at: published,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a story on the page", () => {
  test("a first delivery with its route prints the route", () => {
    const rendered = renderPaperStory(story("first_delivery", ["lee-ann"], {
      origin: "akron_oh_us", destination: "abingdon_va_us", miles: 402,
    }, 2), names)!;
    expect(rendered.body).toContain("Akron, Ohio");
    expect(rendered.body).toContain("402 miles");
    const { headline, body } = storySegments(rendered);
    expect(headline).toContainEqual({ driverId: "lee-ann", displayName: "Lee Ann" });
    // The name is linked once per story: the body names the driver as text.
    expect(body.some((segment) => "driverId" in segment)).toBe(false);
    expect(body.map((segment) => ("text" in segment ? segment.text : "")).join("")).toContain("Lee Ann");
  });

  test("a first delivery without its optional facts still prints, in the plain wording", () => {
    const rendered = renderPaperStory(story("first_delivery", ["lee-ann"], {}, 2), names)!;
    expect(rendered).not.toBeNull();
    expect(rendered.body).not.toMatch(/\{(?!@)/);
    expect(rendered.body).not.toContain("miles");
  });

  test("a story about a driver who is not nameable now is left out", () => {
    expect(renderPaperStory(story("mile_club", ["gone-driver"], { mark: 100_000 }), names)).toBeNull();
  });

  test("a list of new drivers loses the missing one and is recounted", () => {
    const rendered = renderPaperStory({
      ...story("new_hires", ["lee-ann", "gone-driver", "dana-rig"], { count: 3 }), section: "new_hires",
    }, names)!;
    expect(rendered.drivers.map((driver) => driver.driverId)).toEqual(["lee-ann", "dana-rig"]);
    expect(rendered.headline + rendered.body).not.toMatch(/\b3\b/);
  });
});

describe("the edition view", () => {
  const edition = fixtureEdition()!;
  const view = buildPaperView(edition, PAPER_CHROME, {
    latest: true, gameNews: gameNewsFromReleases([release("v1.9.7", "2026-11-21T22:29:00Z")]),
  });

  test("sections follow the wording file, Since Monday first, empty ones left out", () => {
    const keys = view.sections.map((section) => section.key);
    expect(keys[0]).toBe("since_monday");
    const order = Object.keys(edition.sections);
    const rest = keys.slice(1);
    expect([...rest].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(rest);
    expect(keys).not.toContain("firsts");
    for (const section of view.sections) {
      expect(section.stories.length + (section.table ? 1 : 0) + (section.paragraphs?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  test("an issue's days read the same wherever they are named", () => {
    expect(paperIssueLabel({ issue: 24, weekKey: "2026-11-09" })).toBe("Issue 24, November 9 to 15, 2026");
    expect(paperIssueLabel({ issue: 22, weekKey: "2026-10-26" })).toBe("Issue 22, October 26 to November 1, 2026");
    expect(paperIssueLabel({ issue: 30, weekKey: "2026-12-28" })).toBe("Issue 30, December 28, 2026 to January 3, 2027");
  });

  test("an archive page has no Since Monday", () => {
    const archive = buildPaperView(fixtureEdition(24)!, PAPER_CHROME, { latest: false, gameNews: [] });
    expect(archive.sections.map((section) => section.key)).not.toContain("since_monday");
  });

  test("records are a table, and a record held by a driver who left is dropped", () => {
    const records = view.sections.find((section) => section.key === "records")!;
    expect(records.stories).toEqual([]);
    expect(records.table!.caption).toBe(PAPER_CHROME.records.caption);
    expect(records.table!.rows.map((row) => row.header)).not.toContain("Most new cities");
    expect(records.table!.rows[0].cells).toEqual([
      { driverId: "dana-rig", displayName: "Dana Rig" }, { text: "4,210 miles" },
    ]);
  });

  test("carrier standings give the on-time rate, or say it is not recorded", () => {
    const standings = view.sections.find((section) => section.key === "carrier_standings")!.table!;
    expect(standings.rows[0].cells.at(-1)).toEqual({ text: "96.5%" });
    expect(standings.rows.at(-1)!.cells.at(-1)).toEqual({ text: "Not recorded" });
  });

  test("game news holds only stable releases inside the period", () => {
    const news = gameNewsFromReleases([
      release("v1.9.7", "2026-11-21T22:29:00Z"),
      release("v1.9.8-dev", "2026-11-22T10:00:00Z", true),
      release("nightly-2026-11-20", "2026-11-20T10:00:00Z"),
      release("v1.9.6", "2026-11-13T07:55:00Z"),
    ]);
    const built = buildPaperView(edition, PAPER_CHROME, { latest: false, gameNews: news });
    const section = built.sections.find((entry) => entry.key === "game_news")!;
    expect(section.stories.map((entry) => entry.headline)).toEqual([[{ text: "Freight Fate 1.9.7 is out" }]]);
    expect(section.stories[0].link!.label).toBe("Release notes for Freight Fate 1.9.7");
    const none = buildPaperView(edition, PAPER_CHROME, { latest: false, gameNews: [] });
    expect(none.sections.map((entry) => entry.key)).not.toContain("game_news");
  });

  test("the period runs from its first day to the day before it closed, Eastern", () => {
    expect(paperPeriodDays(edition.periodStart, edition.periodEnd)).toEqual({
      firstDay: { iso: "2026-11-16", label: "November 16" },
      lastDay: { iso: "2026-11-22", label: "22, 2026" },
    });
  });

  test("the back page heads each piece with its kind", () => {
    expect(view.backPage!.heading).toBe(PAPER_CHROME.backPageHeading);
    expect(view.backPage!.pieces[0].title).toBe("From the fuel desk: The coffee is the same");
  });
});

describe("wording the page owns", () => {
  test("record results carry their unit, singular for one", () => {
    expect(paperRecordResult("heaviest_load", 44_000)).toBe("44,000 pounds");
    expect(paperRecordResult("most_new_cities", 1)).toBe("1 city");
  });

  test("Since Monday reads as one sentence, and is absent before a load is in", () => {
    expect(sinceMondaySentence({ weekKey: "w", asOf: 0, drivers: 1, loads: 1, miles: 402, tons: 20 }))
      .toBe("1 driver has delivered 1 load and 20 tons of freight over 402 miles.");
    expect(sinceMondaySentence({ weekKey: "w", asOf: 0, drivers: 0, loads: 0, miles: 0, tons: 0 })).toBeNull();
  });

  test("a release tag loses its v", () => {
    expect(releaseVersion({ tag_name: "v1.9.7" })).toBe("1.9.7");
  });
});

describe("earlier issues", () => {
  test("twenty a page, with a link to older ones only when there are more", () => {
    const first = earlierIssues(fixtureListings(), 25);
    expect(first.issues).toHaveLength(20);
    expect(first.issues[0]).toMatchObject({ issue: 24, href: "/freight-fate/news/24" });
    expect(first.olderHref).toBe("/freight-fate/news/archive?before=5");
    const last = earlierIssues(fixtureListings(), 5);
    expect(last.issues.map((row) => row.issue)).toEqual([4, 3, 2, 1]);
    expect(last.olderHref).toBeNull();
  });
});

describe("the feed", () => {
  test("one item per edition, the front-page headlines as its description", () => {
    const edition = fixtureEdition()!;
    const xml = paperFeedXml("https://orinks.net", [
      { issue: 25, publishedAt: edition.publishedAt, weekKey: edition.weekKey, headlines: frontPageHeadlines(edition) },
      { issue: 24, publishedAt: null, weekKey: "2026-11-09", headlines: [] },
    ]);
    expect(xml).toContain(`<title>${PAPER_NAME}, issue 25</title>`);
    expect(xml).toContain("<link>https://orinks.net/freight-fate/news/25</link>");
    expect(xml).toContain("<description>Dana Rig");
    expect(xml).not.toContain("{@");
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml.match(/<description>/g)).toHaveLength(2); // the channel's, and issue 25's
    expect(xml).toContain(new Date("2026-11-16T12:00:00Z").toUTCString());
  });

  test("names are escaped", () => {
    const xml = paperFeedXml("https://orinks.net", [{ issue: 1, publishedAt: 0, weekKey: "", headlines: ["A & B <c>"] }]);
    expect(xml).toContain("A &amp; B &lt;c&gt;.");
  });
});
