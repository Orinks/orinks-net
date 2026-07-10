// @vitest-environment node

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseArgs, run } from "./collect-official-music.mjs";

describe("official music collector CLI", () => {
  it("parses source, input, output, limit, and no-write preview", () => {
    const args = parseArgs([
      "--source",
      "unesco",
      "--limit",
      "3",
      "--input",
      "download.json",
      "--output",
      "stage.json",
      "--preview",
    ]);

    expect(args).toMatchObject({
      source: "unesco",
      limit: 3,
      input: "download.json",
      output: "stage.json",
      preview: true,
    });
  });

  it("defaults output to the gitignored editorial cache", () => {
    const args = parseArgs(["--source", "met"]);

    expect(args.output).toContain(path.join(".cache", "trivia", "official-music"));
  });

  it("rejects unknown sources and invalid limits", () => {
    expect(() => parseArgs(["--source", "awards"])).toThrow("--source");
    expect(() => parseArgs(["--source", "met", "--limit", "0"])).toThrow("--limit");
  });

  it("previews normalized staging JSON without writing an output file", async () => {
    const stdout = { write: vi.fn() };
    const args = parseArgs(["--source", "met", "--limit", "1", "--preview"]);
    const collectors = {
      met: vi.fn().mockResolvedValue([
        {
          source: "met",
          sourceId: "1",
          publisher: "The Metropolitan Museum of Art",
          title: "Test instrument",
          url: "https://www.metmuseum.org/art/collection/search/1",
          accessedAt: "2026-07-10",
          rights: { status: "unknown", statement: "Review rights", url: "https://example.test" },
          facts: {},
        },
      ]),
    };

    const result = await run(args, {
      collectors,
      now: new Date("2026-07-10T12:00:00.000Z"),
      stdout,
    });

    expect(result.output).toBeNull();
    expect(JSON.parse(stdout.write.mock.calls[0][0])).toMatchObject({
      source: "met",
      itemCount: 1,
    });
  });
});
