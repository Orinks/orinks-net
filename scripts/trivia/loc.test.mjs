// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { collectLoc, normalizeLocItem } from "./sources/loc.mjs";

const fixture = (name) =>
  readFile(new URL(`./test/fixtures/${name}`, import.meta.url), "utf8").then(JSON.parse);

describe("Library of Congress National Jukebox collector", () => {
  it("normalizes exact item links, Unicode, and item-level rights advice", async () => {
    const search = await fixture("loc-search.json");
    const detail = await fixture("loc-item.json");
    const item = normalizeLocItem(search.results[0], detail, "2026-07-10");

    expect(item.title).toBe("La cafétera");
    expect(item.url).toBe("https://www.loc.gov/item/jukebox-1001/");
    expect(item.rights.status).toBe("rights-advisory");
    expect(item.rights.statement).toContain("National Jukebox");
  });

  it("uses the official faceted Jukebox query and fetches details sequentially", async () => {
    const search = await fixture("loc-search.json");
    const detail = await fixture("loc-item.json");
    const request = vi
      .fn()
      .mockResolvedValueOnce(search)
      .mockResolvedValueOnce(detail);

    const items = await collectLoc({ limit: 1, accessedAt: "2026-07-10", request });

    expect(items).toHaveLength(1);
    expect(request.mock.calls[0][0]).toContain("collections/national-jukebox");
    expect(request.mock.calls[0][0]).toContain("dates=1900%2F1922");
  });
});
