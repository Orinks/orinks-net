import { describe, expect, test } from "vitest";
import { effectiveMusicLevel } from "./music";

describe("mystery-clip music suppression", () => {
  test("restores the exact configured level after suppression", () => {
    expect(effectiveMusicLevel(0.63, false, 0)).toBe(0.63);
    expect(effectiveMusicLevel(0.63, false, 1)).toBe(0);
    expect(effectiveMusicLevel(0.63, false, 2)).toBe(0);
    expect(effectiveMusicLevel(0.63, true, 0)).toBe(0);
  });
});
