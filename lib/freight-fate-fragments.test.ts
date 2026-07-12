import { expect, test } from "vitest";
import { freightFateEventFragment } from "./freight-fate-fragments";

test("event fragment keys are collision-free and safe for adversarial IDs", () => {
  const ids = ["plain", "with spaces", "hash#mark", "query?mark", "percent%mark", "Ünicode 🚚"];
  const fragments = ids.map(freightFateEventFragment);
  expect(new Set(fragments).size).toBe(ids.length);
  for (const fragment of fragments) expect(fragment).toMatch(/^event-[A-Za-z0-9_-]+$/);
});
