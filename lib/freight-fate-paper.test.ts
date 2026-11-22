import { describe, expect, test } from "vitest";
import phrases from "../data/freight-fate-paper-phrases.json";
import backPage from "../data/freight-fate-paper-back-page.json";
import {
  PAPER_BACK_PAGE,
  PAPER_PHRASES,
  backPageFor,
  chooseVariant,
  cityKeyFromText,
  crossedMark,
  deliveryV2Problem,
  easternDateKey,
  editionReadable,
  formatPaperNumber,
  nextEditionState,
  nextWeekStartMs,
  paperMode,
  paperTextPlain,
  paperTextSegments,
  pickFrontPage,
  renderPaperStory,
  validatePaperBackPage,
  validatePaperPhrases,
  weekKeyOf,
  weekStartMs,
  weeksCovered,
  whenPhrase,
  type EditionEvent,
  type EditionState,
  type PaperStory,
} from "./freight-fate-paper";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("the data files", () => {
  test("load", () => {
    expect(Object.keys(PAPER_PHRASES.kinds).length).toBeGreaterThan(20);
    expect(PAPER_BACK_PAGE.pieces.length).toBeGreaterThanOrEqual(12);
  });

  test("a kind with no wording that needs only its always slots is refused", () => {
    const bad = clone(phrases) as typeof phrases;
    bad.kinds.longest_haul.variants = [bad.kinds.longest_haul.variants[1]];
    expect(() => validatePaperPhrases(bad)).toThrow(/only its always slots/);
  });

  test("a wording naming a slot its kind cannot have is refused", () => {
    const bad = clone(phrases) as typeof phrases;
    bad.kinds.promotion.variants[0].body = "{driver} reached {cash}.";
    expect(() => validatePaperPhrases(bad)).toThrow(/cash/);
  });

  test("{when} is accepted in any body and refused in a headline", () => {
    const ok = clone(phrases) as typeof phrases;
    ok.kinds.tons_total.variants[0].body = "{tons} tons {when}.";
    expect(() => validatePaperPhrases(ok)).not.toThrow();
    const bad = clone(phrases) as typeof phrases;
    bad.kinds.tons_total.variants[0].headline = "{tons} tons {when}";
    expect(() => validatePaperPhrases(bad)).toThrow(/headline/);
    const listed = clone(phrases) as typeof phrases;
    listed.kinds.tons_total.always = ["tons", "when"];
    expect(() => validatePaperPhrases(listed)).toThrow(/when/);
  });

  test("an empty headline is refused", () => {
    const bad = clone(phrases) as typeof phrases;
    bad.kinds.tons_total.variants[0].headline = " ";
    expect(() => validatePaperPhrases(bad)).toThrow(/empty headline/);
  });

  test("a back-page piece with a brace slot or a repeated id is refused", () => {
    const braces = clone(backPage) as typeof backPage;
    braces.pieces[0].body = ["Hello {driver}."];
    expect(() => validatePaperBackPage(braces)).toThrow(/brace slot/);
    const repeated = clone(backPage) as typeof backPage;
    repeated.pieces[1].id = repeated.pieces[0].id;
    expect(() => validatePaperBackPage(repeated)).toThrow(/repeated id/);
  });

  test("the back page rotates each kind on its own count", () => {
    const counts = Object.fromEntries(Object.keys(PAPER_BACK_PAGE.kinds)
      .map((kind) => [kind, PAPER_BACK_PAGE.pieces.filter((piece) => piece.kind === kind)]));
    const first = backPageFor(1);
    expect(first).toEqual(Object.values(counts).map((pieces) => pieces[0].id));
    for (const [index, kind] of Object.keys(counts).entries()) {
      const pieces = counts[kind];
      expect(backPageFor(pieces.length + 1)[index]).toBe(pieces[0].id);
      expect(backPageFor(pieces.length)[index]).toBe(pieces.at(-1)!.id);
    }
  });
});

describe("edition state", () => {
  const states: EditionState[] = ["building", "preview", "published", "pulled"];
  const events: EditionEvent[] = ["finish_preview", "finish_public", "publish", "pull"];
  const table: Record<EditionState, Partial<Record<EditionEvent, EditionState>>> = {
    building: { finish_preview: "preview", finish_public: "published" },
    preview: { publish: "published", pull: "pulled" },
    published: { pull: "pulled" },
    pulled: { publish: "published" },
  };
  for (const state of states) {
    for (const event of events) {
      const expected = table[state][event];
      test(`${state} + ${event} -> ${expected ?? "throws"}`, () => {
        if (expected) expect(nextEditionState(state, event)).toBe(expected);
        else expect(() => nextEditionState(state, event)).toThrow();
      });
    }
  }

  test("who reads what", () => {
    expect(editionReadable("published", "off", true)).toBe(false);
    expect(editionReadable("published", "on", false)).toBe(true);
    expect(editionReadable("published", "preview", false)).toBe(false);
    expect(editionReadable("published", "preview", true)).toBe(true);
    expect(editionReadable("preview", "on", false)).toBe(false);
    expect(editionReadable("preview", "on", true)).toBe(true);
    expect(editionReadable("pulled", "on", true)).toBe(false);
    expect(editionReadable("building", "on", true)).toBe(false);
  });

  test("the switch", () => {
    expect(paperMode(undefined)).toBe("off");
    expect(paperMode("")).toBe("off");
    expect(paperMode("off")).toBe("off");
    expect(paperMode("yes")).toBe("off");
    expect(paperMode(" preview ")).toBe("preview");
    expect(paperMode("on")).toBe("on");
  });
});

describe("Eastern weeks", () => {
  test("a week starts Monday at midnight Eastern, across daylight time", () => {
    // Summer: EDT, Monday 04:00 UTC.
    expect(weekStartMs(Date.UTC(2026, 6, 15, 12))).toBe(Date.UTC(2026, 6, 13, 4));
    // Winter: EST, Monday 05:00 UTC.
    expect(weekStartMs(Date.UTC(2026, 10, 18, 12))).toBe(Date.UTC(2026, 10, 16, 5));
    // Sunday night Eastern is still the old week.
    expect(weekKeyOf(Date.UTC(2026, 10, 16, 4, 59))).toBe("2026-11-09");
    expect(weekKeyOf(Date.UTC(2026, 10, 16, 5))).toBe("2026-11-16");
    // The week holding the November change.
    expect(weekStartMs(Date.UTC(2026, 10, 1, 12))).toBe(Date.UTC(2026, 9, 26, 4));
    expect(nextWeekStartMs(Date.UTC(2026, 9, 26, 4))).toBe(Date.UTC(2026, 10, 2, 5));
    // The week holding the March change (Sunday 2027-03-14).
    expect(nextWeekStartMs(Date.UTC(2027, 2, 8, 5))).toBe(Date.UTC(2027, 2, 15, 4));
    expect(easternDateKey(Date.UTC(2026, 10, 16, 12))).toBe("2026-11-16");
  });
});

describe("the period", () => {
  test("weeks covered and the words for them", () => {
    expect(weeksCovered(Date.UTC(2026, 10, 9, 5), Date.UTC(2026, 10, 16, 5))).toBe(1);
    expect(weeksCovered(Date.UTC(2026, 10, 2, 5), Date.UTC(2026, 10, 16, 5))).toBe(2);
    // Across the November change.
    expect(weeksCovered(Date.UTC(2026, 9, 26, 4), Date.UTC(2026, 10, 9, 5))).toBe(2);
    expect(whenPhrase(1)).toBe("this week");
    expect(whenPhrase(2)).toBe("in the last two weeks");
    expect(whenPhrase(12)).toBe("in the last twelve weeks");
    expect(whenPhrase(13)).toBe("in the last 13 weeks");
  });
});

describe("catalog matching", () => {
  test("exact labels and unique city names only", () => {
    expect(cityKeyFromText("Chicago, Illinois")).toBe("chicago_il_us");
    expect(cityKeyFromText("Gary")).toBe("gary_in_us");
    expect(cityKeyFromText("chicago, illinois")).toBeUndefined();
    expect(cityKeyFromText("Atlantis, Nowhere")).toBeUndefined();
    expect(cityKeyFromText(42)).toBeUndefined();
  });

  test("version 2 keys are checked", () => {
    const ok = { cargoKey: "bulk", originKey: "chicago_il_us", destinationKey: "gary_in_us" };
    expect(deliveryV2Problem(ok)).toBeNull();
    expect(deliveryV2Problem({ ...ok, cargoKey: "gold" })).toBe("unknown_cargo");
    expect(deliveryV2Problem({ ...ok, destinationKey: "x" })).toBe("unknown_city");
    expect(deliveryV2Problem({ ...ok, conditions: { weather: Array(9).fill("rain") } })).toBe("unknown_weather");
    expect(deliveryV2Problem({ ...ok, conditions: { inspections: 1.5 } })).toBe("bad_count");
  });

  test("marks", () => {
    expect(crossedMark(99_000, 100_100, [100_000, 250_000])).toBe(100_000);
    expect(crossedMark(100_000, 100_100, [100_000])).toBeUndefined();
    expect(crossedMark(90, 600, [100, 500, 1_000])).toBe(500);
  });
});

describe("rendering", () => {
  const story = (fields: Partial<PaperStory>): PaperStory => ({
    id: "s", section: "records", kind: "longest_haul", driverIds: ["bob-1"],
    facts: { miles: 2400 }, variant: 0, rank: 10, ...fields,
  });
  const names = new Map([["bob-1", "Bob {Freight}"], ["ann", "Ann"]]);

  test("names stay markers; missing facts fall back to the plain wording", () => {
    // Variant 1 needs the cargo and cities; without them the story takes
    // the wording whose body is empty.
    const rendered = renderPaperStory(story({ variant: 1 }), names)!;
    expect(rendered.body).toBe("");
    expect(paperTextPlain(rendered.headline, rendered.drivers)).toBe("Longest haul: Bob {Freight}, 2,400 miles");
    expect(paperTextSegments(rendered.headline, rendered.drivers)).toEqual([
      { text: "Longest haul: " },
      { driverId: "bob-1", displayName: "Bob {Freight}" },
      { text: ", 2,400 miles" },
    ]);
  });

  test("the {when} slot still fills, for wording that uses it", () => {
    const phrases = structuredClone(PAPER_PHRASES);
    phrases.kinds.longest_haul.variants![0].body = "{driver} ran it {when}.";
    expect(renderPaperStory(story({}), names, phrases, whenPhrase(3))!.body).toBe("{@bob-1} ran it in the last three weeks.");
    expect(renderPaperStory(story({}), names, phrases)!.body).toBe("{@bob-1} ran it this week.");
  });

  test("an empty body is allowed and a blank one is refused", () => {
    const empty = structuredClone(phrases);
    empty.kinds.tons_total.variants[0].body = "";
    expect(() => validatePaperPhrases(empty)).not.toThrow();
    const blank = structuredClone(phrases);
    blank.kinds.tons_total.variants[0].body = "  ";
    expect(() => validatePaperPhrases(blank)).toThrow(/blank body/);
  });

  test("a story about a driver who is not nameable is dropped", () => {
    expect(renderPaperStory(story({ driverIds: ["gone"] }), names)).toBeNull();
    expect(renderPaperStory(story({ pulled: true }), names)).toBeNull();
  });

  test("a list of drivers loses the hidden ones and is recounted", () => {
    const hires = story({ kind: "new_hires", section: "new_hires", driverIds: ["ann", "gone", "bob-1"], facts: { count: 3 } });
    const rendered = renderPaperStory(hires, names)!;
    expect(rendered.headline).toBe("2 new drivers sign on");
    expect(rendered.body).toBe("{@ann} and {@bob-1}.");
    const one = renderPaperStory({ ...hires, driverIds: ["ann", "gone"] }, names)!;
    expect(one.headline).toBe("One new driver signs on");
    expect(renderPaperStory({ ...hires, driverIds: ["gone"] }, names)).toBeNull();
  });

  test("the wording is chosen once among those the facts can fill", () => {
    const facts = { miles: 900, cargo: "not-a-cargo-label", origin: "chicago_il_us", destination: "gary_in_us" };
    // Cargo has no label in the export yet, so only the plain wording fits.
    expect(chooseVariant("longest_haul", 7, ["bob-1"], facts)).toBe(0);
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((issue) => chooseVariant("promotion", issue, ["bob-1"], {
      title: "Regional Regular", level: 6, carrier: "northstar",
    })));
    expect(variants.size).toBeGreaterThan(1);
    expect(chooseVariant("promotion", 3, ["bob-1"], { title: "Regional Regular", level: 6 }))
      .not.toBe(1); // the carrier wording needs a carrier
  });

  test("numbers", () => {
    expect(formatPaperNumber(1_412)).toBe("1,412");
    expect(formatPaperNumber(97.46)).toBe("97.5");
    expect(formatPaperNumber(1_000_000)).toBe("1,000,000");
  });
});

describe("the front page", () => {
  const s = (id: string, kind: string, rank: number, driver?: string): PaperStory => ({
    id, section: "driver_news", kind, driverIds: driver ? [driver] : [], facts: {}, variant: 0, rank,
  });

  test("top three by rank; ties go to whoever led least recently", () => {
    const stories = [
      s("a", "promotion", 60, "ann"), s("b", "promotion", 60, "bea"), s("c", "most_miles", 50, "cy"),
      s("d", "first_into_city", 90, "dee"), s("e", "week_totals", 95),
    ];
    const picked = pickFrontPage(stories, new Map([["ann", 4], ["bea", 2]])).map((story) => story.id);
    expect(picked).toEqual(["d", "b", "a"]);
  });
});
