import { beforeEach, describe, expect, test, vi } from "vitest";

const cacheCalls = vi.hoisted(
  () => [] as Array<{ keyParts: string[]; revalidate?: number; tags?: string[] }>,
);
// Stands in for the Next.js Data Cache. It has to actually memoize: the bug
// this file guards against was storing a *failed* render, which a pass-through
// mock cannot tell apart from a successful one.
const cacheStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock("next/cache", () => ({
  unstable_cache: <Args extends unknown[], Result>(
    callback: (...args: Args) => Promise<Result>,
    keyParts: string[],
    options?: { revalidate?: number; tags?: string[] },
  ) => {
    cacheCalls.push({ keyParts, revalidate: options?.revalidate, tags: options?.tags });

    return async (...args: Args): Promise<Result> => {
      const key = JSON.stringify([keyParts, args]);

      if (cacheStore.has(key)) {
        return cacheStore.get(key) as Result;
      }

      // A rejection is never stored, matching the real cache.
      const result = await callback(...args);
      cacheStore.set(key, result);
      return result;
    };
  },
}));

import { getReleases, renderMarkdown, stripSnapshotPreamble } from "./github";

describe("snapshot preamble", () => {
  const preamble =
    "Preview snapshot for players who want the newest features before the next stable " +
    "release. Expect rough edges; your save files stay compatible whenever possible, but " +
    "back them up first.";

  test("the downloads page opens on the first section, not the boilerplate", () => {
    const body = `${preamble}\n\n## Changes since the previous snapshot\n\n## Changed\n- **Fog is silent now.** Gone.\n`;

    expect(stripSnapshotPreamble(body)).toBe("## Changed\n- **Fog is silent now.** Gone.");
  });

  test("a first snapshot's framing goes the same way, footer kept", () => {
    const body = `${preamble}\r\n\r\n## Changes in this snapshot\r\n\r\n### Added\r\n- **A thing.**\r\n\r\n## Complete change list\r\n\r\nRead CHANGELOG.md.`;

    expect(stripSnapshotPreamble(body)).toBe(
      "### Added\n- **A thing.**\n\n## Complete change list\n\nRead CHANGELOG.md.",
    );
  });

  test("stable notes and empty bodies pass through untouched", () => {
    expect(stripSnapshotPreamble("## Fixed\n- **Stable fix.**")).toBe("## Fixed\n- **Stable fix.**");
    expect(stripSnapshotPreamble(null)).toBeNull();
    expect(stripSnapshotPreamble("")).toBe("");
  });
});

describe("GitHub response caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cacheStore.clear();
  });

  test("persists release and rendered-note responses with bounded revalidation", () => {
    expect(cacheCalls).toEqual([
      {
        keyParts: ["github-releases"],
        revalidate: 60,
        tags: ["github-releases"],
      },
      {
        keyParts: ["github-rendered-markdown"],
        revalidate: 86_400,
        // Tagged so a new build can drop rendered notes. Untagged, a failed
        // render stuck around for a day with no way to purge it.
        tags: ["github-rendered-markdown"],
      },
    ]);
  });

  test("keeps upstream requests private to the cache fill", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await expect(getReleases("Freight-Fate")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/Orinks/Freight-Fate/releases?per_page=20",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  test("caches rendered release notes independently by their arguments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<p>Fixed.</p>", { status: 200 }),
    );

    await expect(renderMarkdown("Fixed.", "Freight-Fate")).resolves.toBe("<p>Fixed.</p>");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/markdown",
      expect.objectContaining({ cache: "no-store", method: "POST" }),
    );
  });

  test("a failed render is not cached, so the next request retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 403 }))
      .mockResolvedValueOnce(new Response("<p>Fixed.</p>", { status: 200 }));

    // The caller degrades gracefully...
    await expect(renderMarkdown("Fixed.", "Freight-Fate")).resolves.toBeNull();
    // ...but the failure must not become the cached answer. Returning null from
    // inside unstable_cache pinned raw markdown on the downloads page for a day.
    await expect(renderMarkdown("Fixed.", "Freight-Fate")).resolves.toBe("<p>Fixed.</p>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
