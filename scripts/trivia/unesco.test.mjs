// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { collectUnesco, normalizeUnescoGraph } from "./sources/unesco.mjs";

const fixtureUrl = (name) => new URL(`./test/fixtures/${name}`, import.meta.url);

describe("UNESCO DIVE collector", () => {
  it("extracts music-related elements and their graph relationships", async () => {
    const graph = JSON.parse(await readFile(fixtureUrl("unesco-graph.json"), "utf8"));
    const items = normalizeUnescoGraph(graph, {
      limit: 10,
      accessedAt: "2026-07-10",
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Café marimba tradition");
    expect(items[0].facts.description).toContain("music, dance");
    expect(items[0].facts.concepts).toContain("Musical instruments");
    expect(items[0].facts.countries).toContain("Exampleland");
    expect(items[0].url).toMatch(/^https:\/\/ich\.unesco\.org\//);
  });

  it("accepts a browser-downloaded self-explanatory CSV file", async () => {
    const items = await collectUnesco({
      input: fixtureUrl("unesco-elements.csv"),
      limit: 10,
      accessedAt: "2026-07-10",
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Café drum tradition");
    expect(items[0].facts.concepts).toEqual(["Music", "Drums"]);
  });

  it("turns CAPTCHA or WAF responses into browser-assisted download guidance", async () => {
    const request = vi.fn().mockRejectedValue(
      Object.assign(new Error("UNESCO DIVE returned HTTP 403"), {
        status: 403,
        bodySnippet: "<!doctype html><title>Attention Required</title> captcha",
      }),
    );

    await expect(
      collectUnesco({ limit: 1, accessedAt: "2026-07-10", request }),
    ).rejects.toThrow(/open the UNESCO DIVE open-data page in a browser.*--input/is);
  });
});
