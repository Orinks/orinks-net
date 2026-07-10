// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { collectMet, normalizeMetObject } from "./sources/met.mjs";

const fixture = (name) =>
  readFile(new URL(`./test/fixtures/${name}`, import.meta.url), "utf8").then(JSON.parse);

describe("Met Collection API collector", () => {
  it("normalizes a musical-instrument record with canonical URL and rights", async () => {
    const raw = await fixture("met-object.json");
    const item = normalizeMetObject(raw, "2026-07-10");

    expect(item.title).toBe("Kora Café");
    expect(item.url).toBe("https://www.metmuseum.org/art/collection/search/501001");
    expect(item.rights.status).toBe("public-domain");
    expect(item.accessedAt).toBe("2026-07-10");
    expect(item.facts.culture).toBe("Mande peoples");
  });

  it("uses the Musical Instruments department and obeys the limit", async () => {
    const search = await fixture("met-search.json");
    const object = await fixture("met-object.json");
    const request = vi.fn(async (url) =>
      url.includes("departmentIds=18") ? search : object,
    );

    const items = await collectMet({ limit: 1, accessedAt: "2026-07-10", request });

    expect(items).toHaveLength(1);
    expect(request.mock.calls[0][0]).toContain("departmentIds=18");
  });
});
