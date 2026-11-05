import { describe, expect, it } from "vitest";
import { parseRecentTracks } from "@/lib/lastfm";

describe("parseRecentTracks", () => {
  it("skips the now-playing track and keeps scrobbles newest first", () => {
    const tracks = parseRecentTracks({
      recenttracks: {
        track: [
          { name: "Live", artist: { "#text": "A" }, "@attr": { nowplaying: "true" } },
          { name: "New", artist: { "#text": "B" }, date: { uts: "1793000000" } },
          { name: "Old", artist: { "#text": "C" }, date: { uts: "1792000000" } },
        ],
      },
    });

    expect(tracks.map((track) => track.title)).toEqual(["New", "Old"]);
    expect(tracks[0].publishedAt).toBe(new Date(1793000000 * 1000).toISOString());
  });

  it("accepts a single track object", () => {
    expect(parseRecentTracks({ recenttracks: { track: { name: "Solo", date: { uts: "1" } } } })).toHaveLength(1);
  });
});
