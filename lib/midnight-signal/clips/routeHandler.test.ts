import { describe, expect, test, vi } from "vitest";
import type { ClipCatalogRecord } from "./types";
import { serveMysteryClipRequest } from "./routeHandler";

const record: ClipCatalogRecord = {
  id: "ms-clip-7f3a91c2",
  provider: "audius",
  providerAssetId: "answer-bearing-provider-id",
  startSeconds: 0,
  durationSeconds: 12,
  textClue: "A verified deep-house release.",
  accessedAt: "2026-07-10",
  artistPublished: {
    uploader: "Jazcardan",
    uploaderVerified: true,
    title: "Jazcardan - Funky Road",
    permalink: "https://audius.co/Jazcardan/jazcardan-funky-road",
    genre: "Deep House",
    releasedAt: "2026-07-03T21:00:00Z",
    streamable: true,
    explicit: false,
    cover: false,
    remix: false,
  },
  attribution: {
    creator: "Jazcardan",
    copyrightNotice: "Copyright © 2026 Jazcardan.",
    licenseTitle: "Audius Open Music License",
    licenseUrl: "https://audius.org/open-music-license.pdf",
    sourceTitle: "Jazcardan - Funky Road",
    sourceUrl: "https://audius.co/Jazcardan/jazcardan-funky-road",
  },
};

describe("serveMysteryClipRequest", () => {
  test("looks up only the opaque ID and returns a no-store audio response", async () => {
    const lookup = vi.fn(() => record);
    const openStream = vi.fn(async () =>
      new Response(new Uint8Array([1]), {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-0/10",
        },
      }),
    );

    const response = await serveMysteryClipRequest(
      new Request("https://orinks.net/api/midnight-signal/clips/ms-clip-7f3a91c2", {
        headers: { Range: "bytes=0-1023" },
      }),
      "ms-clip-7f3a91c2",
      { lookup, openStream },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(lookup).toHaveBeenCalledWith("ms-clip-7f3a91c2");
    expect(openStream).toHaveBeenCalledWith(
      record,
      expect.objectContaining({ range: "bytes=0-1023" }),
    );
  });

  test("makes unknown IDs indistinguishable from provider failures", async () => {
    const response = await serveMysteryClipRequest(
      new Request("https://orinks.net/api/midnight-signal/clips/unknown"),
      "unknown",
      { lookup: () => undefined, openStream: vi.fn() },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "Mystery clip is temporarily unavailable." });
  });

  test("does not leak an upstream provider error or asset ID", async () => {
    const response = await serveMysteryClipRequest(
      new Request("https://orinks.net/api/midnight-signal/clips/ms-clip-7f3a91c2"),
      "ms-clip-7f3a91c2",
      {
        lookup: () => record,
        openStream: async () => {
          throw new Error("provider answer-bearing-provider-id failed");
        },
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Mystery clip is temporarily unavailable." });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("rejects a multipart Range request without calling the provider", async () => {
    const openStream = vi.fn();
    const response = await serveMysteryClipRequest(
      new Request("https://orinks.net/api/midnight-signal/clips/ms-clip-7f3a91c2", {
        headers: { Range: "bytes=0-1,4-5" },
      }),
      "ms-clip-7f3a91c2",
      { lookup: () => record, openStream },
    );

    expect(response.status).toBe(416);
    expect(openStream).not.toHaveBeenCalled();
  });
});
