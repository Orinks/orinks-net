import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { updatePlaylists } from "@/lib/playlists";
import { setSpotifyCacheStoreForTests } from "@/lib/spotify-cache";
import {
  SPOTIFY_FAILURE_COOLDOWN_SECONDS,
  SPOTIFY_UPDATES_FRESH_SECONDS,
  SPOTIFY_UPDATES_STALE_SECONDS,
  getSpotifyPlaylistTrackUpdates,
  parseRetryAfter,
} from "@/lib/spotify";

const START = Date.parse("2026-11-05T04:00:00Z");

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "test-access", token_type: "Bearer", expires_in: 3600 }));
}

function itemsResponse(name: string) {
  return new Response(
    JSON.stringify({
      total: 1,
      items: [
        {
          added_at: "2026-11-01T00:00:00Z",
          item: { name, type: "track", external_urls: { spotify: "https://open.spotify.com/track/x" }, artists: [{ name: "Artist" }] },
        },
      ],
    }),
  );
}

function quotaResponse(retryAfter?: string) {
  return new Response(
    JSON.stringify({ error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } }),
    { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} },
  );
}

function mockSpotify(items: (url: string) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.includes("accounts.spotify.com") ? tokenResponse() : items(url);
  });
}

function playlistCalls(fetchMock: ReturnType<typeof mockSpotify>) {
  return fetchMock.mock.calls.filter(([input]: [unknown, ...unknown[]]) => String(input).includes("/v1/playlists/")).length;
}

describe("cached Spotify playlist updates", () => {
  beforeEach(() => {
    setSpotifyCacheStoreForTests(null);
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "refresh");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("a fresh copy is served without calling Spotify again", async () => {
    const fetchMock = mockSpotify(() => itemsResponse("Song A"));

    const first = await getSpotifyPlaylistTrackUpdates(START);
    expect(first).toHaveLength(updatePlaylists.length);
    expect(playlistCalls(fetchMock)).toBe(updatePlaylists.length);

    const again = await getSpotifyPlaylistTrackUpdates(START + (SPOTIFY_UPDATES_FRESH_SECONDS - 60) * 1000);
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(updatePlaylists.length + 1);
  });

  test("a 429 serves the last good copy, keeps it, and waits out Retry-After", async () => {
    let quota = false;
    const fetchMock = mockSpotify(() => (quota ? quotaResponse("3600") : itemsResponse("Song A")));
    const good = await getSpotifyPlaylistTrackUpdates(START);

    quota = true;
    const stale = START + (SPOTIFY_UPDATES_FRESH_SECONDS + 60) * 1000;
    expect(await getSpotifyPlaylistTrackUpdates(stale)).toEqual(good);
    const callsAfter429 = fetchMock.mock.calls.length;

    // Inside Retry-After nothing is asked of Spotify.
    expect(await getSpotifyPlaylistTrackUpdates(stale + 30 * 60_000)).toEqual(good);
    expect(fetchMock.mock.calls.length).toBe(callsAfter429);

    // Past it Spotify is asked again, and the good copy still survives a second 429.
    expect(await getSpotifyPlaylistTrackUpdates(stale + 61 * 60_000)).toEqual(good);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfter429);

    // Once Spotify recovers, the copy is replaced.
    quota = false;
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("accounts.spotify.com") ? tokenResponse() : itemsResponse("Song B"),
    );
    const recovered = await getSpotifyPlaylistTrackUpdates(stale + 3 * 60 * 60_000);
    expect(recovered[0]?.title).toBe("Song B");
  });

  test("with no good copy a 429 returns nothing and holds off for the default cooldown", async () => {
    const fetchMock = mockSpotify(() => quotaResponse());

    expect(await getSpotifyPlaylistTrackUpdates(START)).toEqual([]);
    const calls = fetchMock.mock.calls.length;
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("QUOTA_EXCEEDED"));

    expect(await getSpotifyPlaylistTrackUpdates(START + (SPOTIFY_FAILURE_COOLDOWN_SECONDS - 60) * 1000)).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(calls);

    expect(await getSpotifyPlaylistTrackUpdates(START + (SPOTIFY_FAILURE_COOLDOWN_SECONDS + 60) * 1000)).toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  test("a partial failure is not stored, so the full good copy stays", async () => {
    const good = await (async () => {
      mockSpotify(() => itemsResponse("Song A"));
      return getSpotifyPlaylistTrackUpdates(START);
    })();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const firstId = updatePlaylists[0]?.id ?? "";
    mockSpotify((url) => (url.includes(firstId) ? quotaResponse() : itemsResponse("Song B")));

    expect(await getSpotifyPlaylistTrackUpdates(START + SPOTIFY_UPDATES_STALE_SECONDS * 500)).toEqual(good);
  });
});

describe("parseRetryAfter", () => {
  test("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter("Thu, 05 Nov 2026 04:10:00 GMT", START)).toBe(600);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
