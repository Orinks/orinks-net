// The deploy's fetch of each game's rules modules from its releases.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fetchRules } from "@/scripts/fetch-hearken-rules.mjs";

function releases() {
  return [
    {
      draft: false,
      assets: [
        { name: "wickets-1.7.0-rules-0123456789ab.wasm", browser_download_url: "https://dl/a" },
        { name: "wickets-1.7.0-windows-x64.zip", browser_download_url: "https://dl/zip" },
        { name: "update-stable-1.7.0.json", browser_download_url: "https://dl/m" },
      ],
    },
    { draft: true, assets: [{ name: "wickets-1.8.0-rules-ffffffffffff.wasm", browser_download_url: "https://dl/d" }] },
  ];
}

describe("fetching rules modules", () => {
  test("only published modules are fetched, once", async () => {
    const root = mkdtempSync(join(tmpdir(), "rules-"));
    writeFileSync(join(root, "sources.json"), JSON.stringify({ wickets: { repo: "orinks-games/wickets" } }));
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      if (url.startsWith("https://api.github.com/")) return Response.json(releases());
      return new Response(new Uint8Array([0, 97, 115, 109]));
    };
    expect(await fetchRules({ root, get, log: () => {} })).toBe(1);
    expect(readdirSync(join(root, "wickets"))).toEqual(["wickets-1.7.0-rules-0123456789ab.wasm"]);
    expect([...readFileSync(join(root, "wickets", "wickets-1.7.0-rules-0123456789ab.wasm"))]).toEqual([0, 97, 115, 109]);
    expect(asked).not.toContain("https://dl/zip");
    expect(asked).not.toContain("https://dl/d");
    expect(await fetchRules({ root, get, log: () => {} })).toBe(0);
  });

  test("a failed request fails the deploy", async () => {
    const root = mkdtempSync(join(tmpdir(), "rules-"));
    writeFileSync(join(root, "sources.json"), JSON.stringify({ wickets: { repo: "orinks-games/wickets" } }));
    const get = async () => new Response("no", { status: 503, statusText: "Unavailable" });
    await expect(fetchRules({ root, get, log: () => {} })).rejects.toThrow(/503/);
  });
});
