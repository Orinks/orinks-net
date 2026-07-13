import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getReleaseGroupsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github")>();

  return {
    ...actual,
    getReleaseGroups: getReleaseGroupsMock,
  };
});

import { ReleaseDownloads } from "./ReleaseDownloads";

describe("ReleaseDownloads", () => {
  beforeEach(() => {
    getReleaseGroupsMock.mockReset();
  });

  test("shows plain retry guidance and a native fallback link", async () => {
    getReleaseGroupsMock.mockRejectedValue(new Error("GitHub releases request failed: 403"));

    const markup = renderToStaticMarkup(
      await ReleaseDownloads({ productName: "Freight Fate", repo: "Freight-Fate" }),
    );

    expect(markup).toContain("Downloads are temporarily unavailable");
    expect(markup).toContain("Please try again in a few minutes");
    expect(markup).toContain('href="https://github.com/Orinks/Freight-Fate/releases"');
    expect(markup).not.toContain("403");
    expect(markup).not.toContain('role="status"');
  });

  test("keeps rendered note headings inside each release hierarchy", async () => {
    const baseRelease = {
      assets: [],
      body: "## Changes",
      html_url: "https://github.com/Orinks/Freight-Fate/releases/tag/test",
      name: "Test release",
      prerelease: false,
      published_at: "2026-07-13T00:00:00Z",
      tag_name: "test",
    };

    getReleaseGroupsMock.mockResolvedValue({
      stable: { ...baseRelease, body_html: "<h2>Stable changes</h2><h3>Details</h3>" },
      nightlies: [
        {
          ...baseRelease,
          body_html: "<h2>Preview changes</h2><h3>Details</h3>",
          name: "Developer snapshot test",
          prerelease: true,
          tag_name: "nightly-test",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      await ReleaseDownloads({ productName: "Freight Fate", repo: "Freight-Fate" }),
    );

    expect(markup).toContain("<h4>Stable changes</h4><h5>Details</h5>");
    expect(markup).toContain("<h5>Preview changes</h5><h6>Details</h6>");
  });
});
