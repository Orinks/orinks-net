// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  canonicalHttpsUrl,
  isMusicRelated,
  normalizeText,
  stripHtml,
} from "./lib/normalize.mjs";

describe("editorial normalization", () => {
  it("preserves official Unicode spelling in NFC form", () => {
    expect(normalizeText("  Cafe\u0301   del   Mar  ")).toBe("Café del Mar");
  });

  it("removes markup without concatenating words", () => {
    expect(stripHtml("Music<br><strong>and dance</strong> &amp; song")).toBe(
      "Music and dance & song",
    );
  });

  it("upgrades canonical HTTP item links to HTTPS", () => {
    expect(canonicalHttpsUrl("http://www.loc.gov/item/abc/")).toBe(
      "https://www.loc.gov/item/abc/",
    );
  });

  it("detects music terms without ASCII-folding the source text", () => {
    expect(isMusicRelated(["Café", "Traditional kora music"])).toBe(true);
    expect(isMusicRelated(["Café", "Ceramic vessel"])).toBe(false);
  });
});
