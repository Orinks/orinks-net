import { describe, expect, test, vi } from "vitest";
import type { ClipCatalogRecord } from "../types";
import { openRemoteOpenStream } from "./remoteOpen";

const record: ClipCatalogRecord = {
  id: "ms-clip-8a204f6c",
  provider: "remote-open",
  providerAssetId: "https://media.example.org/audio/instrument.mp3",
  startSeconds: 8,
  durationSeconds: 10,
  textClue: "A struck metal instrument with a sustained ringing tone.",
  accessedAt: "2026-07-10",
  artistPublished: {
    uploader: "Example Museum",
    uploaderVerified: true,
    title: "Instrument demonstration",
    permalink: "https://museum.example.org/items/instrument",
    genre: "Instrument demonstration",
    releasedAt: "2025-01-15T00:00:00Z",
    streamable: true,
    explicit: false,
    cover: false,
    remix: false,
  },
  attribution: {
    creator: "Example Museum",
    copyrightNotice: "Copyright © Example Museum.",
    licenseTitle: "Creative Commons Attribution 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceTitle: "Instrument demonstration",
    sourceUrl: "https://museum.example.org/items/instrument",
  },
};

describe("openRemoteOpenStream", () => {
  test("streams a curated HTTPS asset and forwards one byte range", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-1/10",
        },
      }),
    );

    const response = await openRemoteOpenStream(record, {
      fetchImpl,
      range: "bytes=0-1023",
    });

    expect(response.status).toBe(206);
    expect(fetchImpl).toHaveBeenCalledWith(
      record.providerAssetId,
      expect.objectContaining({
        cache: "no-store",
        redirect: "manual",
      }),
    );
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("range")).toBe(
      "bytes=0-1023",
    );
  });

  test("rejects non-HTTPS, non-audio, and redirect responses", async () => {
    await expect(
      openRemoteOpenStream(
        { ...record, providerAssetId: "http://media.example.org/audio.mp3" },
        { fetchImpl: vi.fn<typeof fetch>() },
      ),
    ).rejects.toMatchObject({ code: "remote_open.url" });

    const nonAudioFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("html", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(
      openRemoteOpenStream(record, { fetchImpl: nonAudioFetch }),
    ).rejects.toMatchObject({ code: "remote_open.content_type" });

    const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private-audio" },
      }),
    );
    await expect(
      openRemoteOpenStream(record, { fetchImpl: redirectFetch }),
    ).rejects.toMatchObject({ code: "remote_open.http" });
  });
});
