import { describe, expect, test } from "vitest";
import { absolutePlaylist } from "./hls-playlist";

describe("absolutePlaylist", () => {
  test("makes segments, variants and URI attributes absolute against the playlist's address", () => {
    const base = new URL("https://cdn.example.com/live/station/index.m3u8?token=1");
    const text = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:10",
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="/keys/1"',
      "#EXTINF:10,",
      "seg-1.aac",
      "",
      "#EXT-X-STREAM-INF:BANDWIDTH=64000",
      "../hi/index.m3u8",
      "https://other.example.com/seg-2.ts",
    ].join("\r\n");
    expect(absolutePlaylist(text, base).split("\n")).toEqual([
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:10",
      '#EXT-X-MAP:URI="https://cdn.example.com/live/station/init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/keys/1"',
      "#EXTINF:10,",
      "https://cdn.example.com/live/station/seg-1.aac",
      "",
      "#EXT-X-STREAM-INF:BANDWIDTH=64000",
      "https://cdn.example.com/live/hi/index.m3u8",
      "https://other.example.com/seg-2.ts",
    ]);
  });

  test("passes every address through the wrapper", () => {
    const wrap = (address: string) => `/proxy?url=${encodeURIComponent(address)}`;
    expect(absolutePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg.ts', new URL("https://a.example/x/i.m3u8"), wrap)).toBe(
      '#EXTM3U\n#EXT-X-MAP:URI="/proxy?url=https%3A%2F%2Fa.example%2Fx%2Finit.mp4"\n/proxy?url=https%3A%2F%2Fa.example%2Fx%2Fseg.ts',
    );
  });
});
