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
    expect(markup).toContain('href="https://github.com/orinks-games/Freight-Fate/releases"');
    expect(markup).not.toContain("403");
    expect(markup).not.toContain('role="status"');
  });

  test("keeps rendered note headings inside each release hierarchy", async () => {
    const baseRelease = {
      assets: [],
      body: "## Changes",
      html_url: "https://github.com/orinks-games/Freight-Fate/releases/tag/test",
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

  test("lists the Apple Silicon zip once and still counts the updater copy's downloads", async () => {
    const asset = (name: string, download_count: number) => ({
      name,
      download_count,
      browser_download_url: `https://github.com/orinks-games/Freight-Fate/releases/download/v1.9.3/${name}`,
    });

    getReleaseGroupsMock.mockResolvedValue({
      stable: {
        assets: [
          asset("FreightFate-v1.9.3-macos-arm64.zip", 5),
          asset("FreightFate-v1.9.3-macos.zip", 7),
          asset("FreightFate-v1.9.3-windows-portable.zip", 10),
        ],
        body: "",
        body_html: null,
        html_url: "https://github.com/orinks-games/Freight-Fate/releases/tag/v1.9.3",
        name: "Freight Fate 1.9.3",
        prerelease: false,
        published_at: "2026-10-07T00:00:00Z",
        tag_name: "v1.9.3",
      },
      nightlies: [],
    });

    const markup = renderToStaticMarkup(
      await ReleaseDownloads({ productName: "Freight Fate", repo: "Freight-Fate" }),
    );

    expect(markup).toContain("FreightFate-v1.9.3-macos-arm64.zip");
    expect(markup).not.toContain("FreightFate-v1.9.3-macos.zip");
    expect(markup.match(/macOS ZIP archive/g)).toHaveLength(1);
    expect(markup).toContain("Total downloads: 22");
  });

  test("sends PortkeyDrop's fallback link to its new maintainer's releases", async () => {
    getReleaseGroupsMock.mockRejectedValue(new Error("GitHub releases request failed: 404"));

    const markup = renderToStaticMarkup(
      await ReleaseDownloads({ productName: "PortkeyDrop", repo: "PortkeyDrop" }),
    );

    expect(markup).toContain('href="https://github.com/Nick6489/PortkeyDrop/releases"');
  });

  test("leaves out the build notification signup when a project does not send them", async () => {
    getReleaseGroupsMock.mockResolvedValue({ stable: undefined, nightlies: [] });

    const withSignup = renderToStaticMarkup(
      await ReleaseDownloads({ productName: "Freight Fate", repo: "Freight-Fate" }),
    );
    const withoutSignup = renderToStaticMarkup(
      await ReleaseDownloads({
        buildNotifications: false,
        productName: "PortkeyDrop",
        repo: "PortkeyDrop",
      }),
    );

    expect(withSignup).toContain("Build notifications");
    expect(withoutSignup).not.toContain("Build notifications");
    expect(withoutSignup).not.toContain('role="status"');
  });

  test("a game with only beta releases lists the newest without a missing-stable line", async () => {
    getReleaseGroupsMock.mockResolvedValue({
      stable: undefined,
      nightlies: [
        {
          assets: [
            {
              browser_download_url: "https://example.test/FreightFateDispatch-v0.1.4-windows-portable.zip",
              download_count: 3,
              name: "FreightFateDispatch-v0.1.4-windows-portable.zip",
            },
          ],
          body: null,
          body_html: null,
          html_url: "https://github.com/orinks-games/freight-fate-dispatch/releases/tag/v0.1.4",
          name: "Dispatch v0.1.4",
          prerelease: true,
          published_at: "2026-10-13T16:40:24Z",
          tag_name: "v0.1.4",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      await ReleaseDownloads({
        buildNotifications: false,
        prereleaseLabel: "beta releases",
        productName: "Freight Fate: Dispatch",
        repo: "freight-fate-dispatch",
      }),
    );

    expect(markup).toContain("Latest beta release");
    expect(markup).toContain("Windows portable");
    expect(markup).not.toContain("No stable release");
    expect(markup).not.toContain("latest stable release");
  });
});
