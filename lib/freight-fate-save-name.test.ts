import { expect, test, vi } from "vitest";
import { freightFateReleaseSlotName, splitFreightFateSaveSlotName } from "./freight-fate-save-name";
import { normalizeFreightFateSaveName } from "./freight-fate-online";

vi.mock("@/lib/convex", () => ({ getConvexClient: vi.fn() }));

test.each([
  [undefined, "Road _"], [null, "Road _"], [2, "Road _"],
  ["", "Road _"], ["bad", "Road _"], ["2.0.1", "Road _"],
  ["1.8", "Road _"], ["1.9", "Road _"], ["1.10", "Road _ (Career 1)"],
  ["2.0", "Road _ (Career 2)"], ["20.0", "Road _ (Career 20)"],
])("derives a release slot for %s", (line, expected) => {
  expect(freightFateReleaseSlotName("Road 🚚", line)).toBe(expected);
});

test.each(["2", "1", "999"])("splits exactly a valid suffix %s", (major) => {
  expect(splitFreightFateSaveSlotName(`Road (Career ${major})`))
    .toEqual({ base: "Road", suffix: ` (Career ${major})` });
});

test.each(["Road", "", "Road - Career 2", "Road (Career 0)", "Road (Career 02)",
  "Road (Career 1000)", "Road (Career 2) extra", "Road (career 2)"])("leaves %s unsplit", (key) => {
  expect(splitFreightFateSaveSlotName(key)).toEqual({ base: key, suffix: "" });
});

test("the real normalizer preserves suffixes and legacy sanitization", () => {
  expect(normalizeFreightFateSaveName("José 🚚 (Career 2)")).toBe("José _ (Career 2)");
  expect(normalizeFreightFateSaveName("Road - Career 2")).toBe("Road - Career 2");
  expect(normalizeFreightFateSaveName("Road (Career 02)")).toBe("Road _Career 02_");
  expect(normalizeFreightFateSaveName("")).toBe("Driver");
  expect(normalizeFreightFateSaveName(" (Career 2)")).toBe("Driver (Career 2)");
  expect(normalizeFreightFateSaveName("A".repeat(48) + " (Career 2)"))
    .toBe("A".repeat(48) + " (Career 2)");
  expect(normalizeFreightFateSaveName("A".repeat(53) + " (Career 2)")).toHaveLength(64);
  expect(() => normalizeFreightFateSaveName("A".repeat(54) + " (Career 2)"))
    .toThrow("Save name is too long.");
  expect(() => normalizeFreightFateSaveName(null)).toThrow("Save name is required.");
});
