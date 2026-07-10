import { describe, expect, test } from "vitest";
import { isNameBlocked, maskDisplayName, screenDisplayName } from "./moderation";

describe("isNameBlocked", () => {
  test("allows ordinary names", () => {
    for (const name of ["Rig Hauler", "Big Rig Betty", "Night Owl 42", "Scunthorpe Steve"]) {
      expect(isNameBlocked(name), name).toBe(false);
    }
  });

  test("allows innocent names that contain risky substrings", () => {
    // "Osama" is a common given name; "Cassandra" contains "ass".
    for (const name of ["Osama", "Cassandra"]) {
      expect(isNameBlocked(name), name).toBe(false);
    }
  });

  test("blocks profanity and slurs, including leetspeak", () => {
    // Note: letter-by-letter spacing ("f u c k") slips past obscenity's
    // matcher; the display mask plus the admin force-rename cover evasions.
    for (const name of ["fuck", "FuCk this", "sh1t hauler"]) {
      expect(isNameBlocked(name), name).toBe(true);
    }
  });

  test("blocks hate figures and hate symbols", () => {
    for (const name of ["Hitler", "h1tler", "literally hitler", "Nazi Trucker", "n4zi", "1488", "卐"]) {
      expect(isNameBlocked(name), name).toBe(true);
    }
  });
});

describe("screenDisplayName", () => {
  test("accepts a clean name", () => {
    expect(screenDisplayName("Rig Hauler")).toEqual({ ok: true });
  });

  test("rejects blocked names", () => {
    expect(screenDisplayName("Hitler")).toEqual({ ok: false, reason: "blocked" });
  });

  test("rejects names without at least three letters", () => {
    for (const name of ["@#$%&!", "12345678", "ab", "a-1"]) {
      expect(screenDisplayName(name), name).toEqual({ ok: false, reason: "needs_letters" });
    }
  });

  test("counts non-ASCII letters toward the minimum", () => {
    expect(screenDisplayName("Åsa Öberg")).toEqual({ ok: true });
  });
});

describe("maskDisplayName", () => {
  test("passes clean names through unchanged", () => {
    expect(maskDisplayName("Rig Hauler", "abcd1234", "Driver")).toBe("Rig Hauler");
  });

  test("masks blocked names to an anonymous handle", () => {
    expect(maskDisplayName("Hitler", "abcd1234", "Driver")).toBe("Driver 1234");
    expect(maskDisplayName("fuck", "xyz98765")).toBe("Player 8765");
  });
});
