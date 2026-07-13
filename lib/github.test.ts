import { beforeEach, describe, expect, test, vi } from "vitest";

const cacheCalls = vi.hoisted(
  () => [] as Array<{ keyParts: string[]; revalidate?: number; tags?: string[] }>,
);

vi.mock("next/cache", () => ({
  unstable_cache: <Args extends unknown[], Result>(
    callback: (...args: Args) => Promise<Result>,
    keyParts: string[],
    options?: { revalidate?: number; tags?: string[] },
  ) => {
    cacheCalls.push({ keyParts, revalidate: options?.revalidate, tags: options?.tags });
    return callback;
  },
}));

import { getReleases, renderMarkdown } from "./github";

describe("GitHub response caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
        tags: undefined,
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
});
