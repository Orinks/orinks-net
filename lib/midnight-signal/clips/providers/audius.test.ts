import { describe, expect, test, vi } from "vitest";
import type { ClipCatalogRecord } from "../types";
import { openAudiusStream } from "./audius";

const record: ClipCatalogRecord = {
  id: "ms-clip-7f3a91c2",
  provider: "audius",
  providerAssetId: "X6zzGva",
  startSeconds: 0,
  durationSeconds: 12,
  textClue: "A verified 2026 Audius release tagged as deep house.",
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

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "X6zzGva",
      title: "Jazcardan - Funky Road",
      genre: "Deep House",
      release_date: "2026-07-03T21:00:00Z",
      is_streamable: true,
      parental_warning_type: null,
      cover_original_song_title: null,
      remix_of: { tracks: [] },
      access: { stream: true },
      permalink: "/Jazcardan/jazcardan-funky-road",
      user: { name: "Jazcardan", is_verified: true },
      ...overrides,
    },
  };
}

describe("openAudiusStream", () => {
  test("rechecks metadata and forwards one byte range to the live stream", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(metadata()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-2/1000",
            "content-type": "audio/mpeg",
          },
        }),
      );

    const response = await openAudiusStream(record, {
      fetchImpl,
      range: "bytes=0-1023",
    });

    expect(response.status).toBe(206);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.audius.co/v1/tracks/X6zzGva",
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://api.audius.co/v1/tracks/X6zzGva/stream",
    );
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get("range")).toBe(
      "bytes=0-1023",
    );
    expect(fetchImpl.mock.calls[1][1]).toEqual(
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  test.each([
    ["withdrawn", { is_streamable: false }],
    ["blocked", { access: { stream: false } }],
    ["explicit", { parental_warning_type: "explicit" }],
    ["remix", { remix_of: { tracks: [{ parent_track_id: "other" }] } }],
    ["cover", { cover_original_song_title: "Another song" }],
    ["unverified uploader", { user: { name: "Jazcardan", is_verified: false } }],
    ["creator mismatch", { user: { name: "Someone else", is_verified: true } }],
    ["title mismatch", { title: "A different title" }],
    ["genre mismatch", { genre: "House" }],
    ["release-date mismatch", { release_date: "2026-07-04T21:00:00Z" }],
  ])("rejects a %s track before requesting audio", async (_label, overrides) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(metadata(overrides)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(openAudiusStream(record, { fetchImpl })).rejects.toMatchObject({
      code: expect.stringMatching(/^audius\./),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects an upstream stream response that is not audio", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(metadata()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("login page", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    await expect(openAudiusStream(record, { fetchImpl })).rejects.toMatchObject({
      code: "audius.stream.content_type",
    });
  });
});
