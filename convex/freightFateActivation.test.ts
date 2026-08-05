/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
  ACTIVATION_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  formatUserCode,
  mintUserCode,
  normalizeUserCode,
} from "./freightFateActivation";

describe("activation codes", () => {
  test("the alphabet excludes every mishearable character", () => {
    for (const bad of ["O", "I", "L", "S", "Z", "0", "1", "2", "5"]) {
      expect(ACTIVATION_ALPHABET).not.toContain(bad);
    }
    expect(ACTIVATION_ALPHABET).toHaveLength(27);
  });

  test("minted codes use only the alphabet and are the right length", () => {
    for (let i = 0; i < 50; i++) {
      const code = mintUserCode();
      expect(code).toHaveLength(ACTIVATION_CODE_LENGTH);
      for (const char of code) {
        expect(ACTIVATION_ALPHABET).toContain(char);
      }
    }
  });

  test("formatting groups the code in fours", () => {
    expect(formatUserCode("WKQR3468")).toBe("WKQR-3468");
  });

  test("entry forgives case, dashes, and stray spaces", () => {
    expect(normalizeUserCode(" wkqr-3468 ")).toBe("WKQR3468");
    expect(normalizeUserCode("wkqr 3468")).toBe("WKQR3468");
  });

  test("entry rejects anything that is not a full code", () => {
    expect(normalizeUserCode("WKQR")).toBe("");
    expect(normalizeUserCode("WKQR-346!")).toBe("");
    expect(normalizeUserCode(null)).toBe("");
  });
});
