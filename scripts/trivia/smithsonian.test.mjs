// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  collectSmithsonian,
  normalizeSmithsonianRecord,
} from "./sources/smithsonian.mjs";

const fixtureUrl = (name) => new URL(`./test/fixtures/${name}`, import.meta.url);

describe("Smithsonian Open Access collector", () => {
  it("streams supplied line-delimited bulk JSON without an API key", async () => {
    const items = await collectSmithsonian({
      input: fixtureUrl("smithsonian-bulk.jsonl"),
      limit: 1,
      accessedAt: "2026-07-10",
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Café concert program");
    expect(items[0].rights.status).toBe("metadata-cc0");
    expect(items[0].facts.topics).toContain("Jazz");
  });

  it("optionally queries the official API when a key is supplied", async () => {
    const apiResponse = JSON.parse(
      await readFile(fixtureUrl("smithsonian-api.json"), "utf8"),
    );
    const request = vi.fn().mockResolvedValue(apiResponse);

    const items = await collectSmithsonian({
      apiKey: "test-key",
      limit: 1,
      accessedAt: "2026-07-10",
      request,
    });

    expect(items).toHaveLength(1);
    expect(request.mock.calls[0][0]).toContain("api.si.edu/openaccess/api/v1.0/search");
    expect(request.mock.calls[0][0]).toContain("rows=1");
    expect(request.mock.calls[0][0]).toContain("api_key=test-key");
  });

  it("keeps metadata rights separate from object and media restrictions", async () => {
    const lines = (await readFile(fixtureUrl("smithsonian-bulk.jsonl"), "utf8"))
      .trim()
      .split(/\r?\n/);
    const item = normalizeSmithsonianRecord(JSON.parse(lines[1]), "2026-07-10");

    expect(item.rights.statement).toContain("object and media rights may differ");
  });
});
