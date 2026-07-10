import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("mystery clip offline policy", () => {
  test("the service worker has no fetch cache that could retain streamed music", () => {
    const worker = readFileSync("public/sw.js", "utf8");

    expect(worker).not.toMatch(/addEventListener\s*\(\s*["']fetch["']/);
    expect(worker).not.toContain("/api/midnight-signal/clips/");
  });
});
