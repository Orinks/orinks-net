import { expect, test } from "vitest";

import invariants from "../data/freight-fate-profile-invariants.json";
import {
  FREIGHT_FATE_CARRIERS,
  FREIGHT_FATE_COURSE_ONLY_TRAINING,
  FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS,
  FREIGHT_FATE_SPONSORED_TRAINING,
  freightFateCarrierHrefForName,
  listInWords,
  perMile,
  sharePercent,
} from "./freight-fate-carriers";

test("every carrier a save can name links to a carrier page", () => {
  // The profile's Carrier line links by name, and the owner-operator start
  // names a carrier too, so no carrierLabels value may be left without a page.
  for (const name of Object.values(invariants.carrierLabels)) {
    expect(freightFateCarrierHrefForName(name), name).toMatch(/^\/freight-fate\/carriers\/[a-z_]+$/);
  }
  expect(freightFateCarrierHrefForName("Some Other Carrier")).toBeUndefined();
});

test("carriers come from the game's export, in name order", () => {
  expect(FREIGHT_FATE_CARRIERS.map((carrier) => carrier.key).sort())
    .toEqual(Object.keys(invariants.carriers).sort());
  const names = FREIGHT_FATE_CARRIERS.map((carrier) => carrier.name);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS).toEqual(["Northstar Freight Lines"]);
});

test("sponsored training keeps course-only credentials out", () => {
  const sponsored = FREIGHT_FATE_SPONSORED_TRAINING.flatMap((group) => group.labels);
  expect(sponsored).toContain("refrigerated");
  expect(sponsored).not.toContain("hazmat");
  expect(FREIGHT_FATE_COURSE_ONLY_TRAINING).toContain("hazmat");
  const levels = FREIGHT_FATE_SPONSORED_TRAINING.map((group) => group.level);
  expect(levels).toEqual([...levels].sort((a, b) => a - b));
});

test("pay reads as words a screen reader speaks cleanly", () => {
  expect(sharePercent(0.36)).toBe("36 percent");
  expect(perMile(0.82)).toBe("82 cents a mile");
  expect(perMile(1.05)).toBe("1.05 dollars a mile");
  expect(listInWords(["grain"])).toBe("grain");
  expect(listInWords(["grain", "bulk"])).toBe("grain and bulk");
  expect(listInWords(["grain", "farm inputs", "bulk"])).toBe("grain, farm inputs, and bulk");
});
