import { describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) =>
    (...args: Args) => callback(...args),
}));
vi.mock("@/lib/convex", () => ({ getConvexClient: () => null }));

import { PAPER_CHROME, fixtureEdition } from "./freight-fate-paper-page";
import {
  PAPER_SPEECH_MAX_LINE,
  PAPER_SPEECH_MAX_LINES,
  paperSpeech,
  paperSpeechText,
  standingLine,
} from "./freight-fate-paper-speech";

function latest() {
  return paperSpeech(fixtureEdition()!, PAPER_CHROME, { latest: true });
}

function section(heading: string) {
  const found = latest().sections.find((row) => row.heading === heading);
  expect(found, heading).toBeDefined();
  return found!.lines;
}

describe("the paper as the game speaks it", () => {
  test("the header: masthead, issue and the page's date text", () => {
    const speech = latest();
    expect(speech.version).toBe(1);
    expect(speech.masthead).toBe("The Mile Marker");
    expect(speech.issue).toBe(25);
    expect(speech.dates).toBe("November 16 to 22, 2026");
  });

  test("since Monday is its heading and one sentence, on the latest issue only", () => {
    const speech = latest();
    expect(speech.sinceMonday?.heading).toBe("Since Monday, November 23");
    expect(speech.sinceMonday?.sentence).toMatch(/^As of Wednesday, November 25: \d+ drivers have delivered/);
    expect(paperSpeech(fixtureEdition()!, PAPER_CHROME, { latest: false }).sinceMonday).toBeUndefined();
  });

  test("sections come in page order, with the back page last", () => {
    const headings = latest().sections.map((row) => row.heading);
    expect(headings[0]).toBe("Front page");
    expect(headings.at(-1)).toBe("Back page: fiction");
    expect(headings.indexOf("Records")).toBeLessThan(headings.indexOf("Carrier standings"));
  });

  test("a headline-only story is the headline and a full stop; a story with a body adds it", () => {
    const front = section("Front page");
    expect(front).toContain("Dana Rig passes 1,000,000 miles.");
    expect(front).toContain("Mo K is first into Aberdeen, South Dakota. The first delivery there on this paper's record.");
  });

  test("records and standings rows need no column headers", () => {
    expect(section("Records")).toContain("Most miles: Dana Rig, 4,210 miles.");
    const standings = section("Carrier standings");
    expect(standings).toContain("Northstar Freight Lines: 26,400 miles, 58 loads, 12 drivers on the road, 96.5 percent on time.");
    // A rate that is not recorded is left out, not read as "Not recorded".
    expect(standings.find((line) => line.startsWith("Summit Value Logistics"))).toBe(
      "Summit Value Logistics: 3,900 miles, 9 loads, 3 drivers on the road.",
    );
  });

  test("one of anything is singular", () => {
    expect(standingLine({ carrierKey: "x", carrier: "Solo Freight", drivers: 1, loads: 1, miles: 1 }))
      .toBe("Solo Freight: 1 mile, 1 load, 1 driver on the road.");
  });

  test("new hires past four names are the headline, then one line per name", () => {
    expect(section("New hires")).toEqual(["5 new drivers sign on.", "Ike T.", "Lee Ann.", "Nan B.", "Rosa M.", "Tomas V."]);
  });

  test("game news is the headline alone, with no link", () => {
    for (const line of section("Game news")) {
      expect(line).not.toMatch(/https?:|Release notes/);
    }
  });

  test("a back page piece is its kind and title, then a line per paragraph", () => {
    const back = section("Back page: fiction");
    const start = back.indexOf("From the fuel desk: The coffee is the same.");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(back[start + 1]).toMatch(/^A driver asked me this week/);
    expect(back[start + 2]).toMatch(/^He bought a cup from each/);
  });

  test("plain text only, inside the game's limits", () => {
    const speech = latest();
    const lines = speech.sections.flatMap((row) => row.lines);
    expect(lines.length + 1).toBeLessThanOrEqual(PAPER_SPEECH_MAX_LINES);
    for (const line of [...lines, ...speech.sections.map((row) => row.heading)]) {
      expect(line.length).toBeLessThanOrEqual(PAPER_SPEECH_MAX_LINE);
      expect(line).not.toMatch(/[<>%{}]|https?:|\s{2}/);
      expect(line).toBe(line.trim());
    }
  });

  test("the text cleaner", () => {
    expect(paperSpeechText("90%  on\ttime")).toBe("90 percent on time");
    expect(paperSpeechText("see https://orinks.net/x now")).toBe("see now");
    expect(paperSpeechText("<b>bold</b>")).toBe("bbold/b");
  });
});
