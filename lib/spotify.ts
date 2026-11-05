import { playlistUrl, playlists, updatePlaylists } from "@/lib/playlists";
import { getSpotifyCacheStore } from "@/lib/spotify-cache";

const SPOTIFY_ACCOUNTS_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const SPOTIFY_TIMEOUT_MS = 5000;
export const SPOTIFY_AUTH_SCOPES = ["playlist-read-private", "playlist-read-collaborative"];

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifyTrack = {
  external_urls?: {
    spotify?: string;
  };
  name?: string;
  type?: string;
  artists?: Array<{
    name?: string;
  }>;
};

type SpotifyPlaylistItem = {
  added_at?: string | null;
  item?: SpotifyTrack | null;
};

type SpotifyPlaylistItemsResponse = {
  items?: SpotifyPlaylistItem[];
  total?: number;
};

export type SpotifyPlaylistTrackUpdate = {
  title: string;
  description: string;
  href: string;
  playlistId: string;
  playlistTitle: string;
  source: "Spotify";
  publishedAt: string;
  kind: "playlist-track";
};

function getSpotifyCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

export function getSpotifyRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI ?? "https://www.orinks.net/api/spotify/callback";
}

export function getSpotifyLoginKey() {
  return process.env.SPOTIFY_LOGIN_KEY;
}

export function createSpotifyAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export class SpotifyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Spotify request failed: ${status}`);
    this.name = "SpotifyRequestError";
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  return null;
}

async function spotifyFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const path = new URL(url).pathname;
    console.error(`Spotify request to ${path} failed: ${response.status} ${body.slice(0, 500)}`);
    throw new SpotifyRequestError(response.status, parseRetryAfter(response.headers.get("retry-after")));
  }

  return response.json() as Promise<T>;
}

async function getSpotifyAccessToken() {
  const credentials = getSpotifyCredentials();

  if (!credentials) {
    return null;
  }

  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (refreshToken) {
    const token = await spotifyFetch<SpotifyTokenResponse>(SPOTIFY_ACCOUNTS_URL, {
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
      headers: {
        Authorization: createSpotifyAuthHeader(credentials.clientId, credentials.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    return token.access_token;
  }

  // App-only (client credentials) tokens cannot read playlist items under
  // Spotify's Development Mode rules, so a user refresh token is required.
  console.error("SPOTIFY_REFRESH_TOKEN is not set; skipping Spotify playlist updates.");
  return null;
}

async function getPlaylistTrackUpdates(accessToken: string, playlist: (typeof playlists)[number]) {
  const fields =
    "total,items(added_at,item(name,type,external_urls.spotify,artists(name)))";
  const items: SpotifyPlaylistItem[] = [];

  for (let offset = 0; ; offset += 50) {
    const params = new URLSearchParams({
      fields,
      limit: "50",
      market: "US",
      offset: offset.toString(),
    });

    const data = await spotifyFetch<SpotifyPlaylistItemsResponse>(
      `${SPOTIFY_API_URL}/playlists/${playlist.id}/items?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        // Cached as a whole result below, not per request.
        cache: "no-store",
      },
    );

    items.push(...(data.items ?? []));

    if (items.length >= (data.total ?? 0) || (data.items ?? []).length === 0) {
      break;
    }
  }

  return items.flatMap((item): SpotifyPlaylistTrackUpdate[] => {
    const track = item.item;
    const addedAt = item.added_at;

    if (!track || !addedAt || track.type !== "track" || !track.name) {
      return [];
    }

    const artists = track.artists?.map((artist) => artist.name).filter(Boolean).join(", ");
    const description = artists
      ? `${artists} added to ${playlist.title}.`
      : `Added to ${playlist.title}.`;

    return [
      {
        title: track.name,
        description,
        href: track.external_urls?.spotify ?? playlistUrl(playlist.id),
        playlistId: playlist.id,
        playlistTitle: playlist.title,
        source: "Spotify",
        publishedAt: addedAt,
        kind: "playlist-track",
      },
    ];
  });
}

type PlaylistUpdatesResult = {
  tracks: SpotifyPlaylistTrackUpdate[];
  failures: unknown[];
};

async function fetchSpotifyPlaylistTrackUpdates(): Promise<PlaylistUpdatesResult | null> {
  const accessToken = await getSpotifyAccessToken();

  if (!accessToken) {
    return null;
  }

  const results = await Promise.allSettled(
    updatePlaylists.map(async (playlist) => ({
      playlist,
      tracks: await getPlaylistTrackUpdates(accessToken, playlist),
    })),
  );

  const failures: unknown[] = [];
  const tracks = results
    .flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return result.value.tracks;
      }

      const playlist = updatePlaylists[index];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Spotify playlist ${playlist?.id} (${playlist?.title}) failed: ${reason}`);
      failures.push(result.reason);
      return [];
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return { tracks, failures };
}

export const SPOTIFY_UPDATES_CACHE_KEY = "orinks:spotify:playlist-updates:v1";
export const SPOTIFY_COOLDOWN_CACHE_KEY = "orinks:spotify:cooldown:v1";
// A good copy is fresh for this long; after that Spotify is asked again.
export const SPOTIFY_UPDATES_FRESH_SECONDS = 45 * 60;
// A good copy is kept this long to ride out a Spotify outage or quota block.
export const SPOTIFY_UPDATES_STALE_SECONDS = 7 * 24 * 60 * 60;
// Without a Retry-After header, wait this long after a failure.
export const SPOTIFY_FAILURE_COOLDOWN_SECONDS = 15 * 60;
const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;

type CachedUpdates = { fetchedAt: number; tracks: SpotifyPlaylistTrackUpdate[] };

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const store = await getSpotifyCacheStore();
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.error(`Spotify cache read of ${key} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function writeJson(key: string, value: unknown, ttlSeconds: number) {
  try {
    const store = await getSpotifyCacheStore();
    // KV refuses a TTL under 60 seconds.
    await store.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.ceil(ttlSeconds)) });
  } catch (error) {
    console.error(`Spotify cache write of ${key} failed:`, error instanceof Error ? error.message : error);
  }
}

function cooldownSeconds(failures: unknown[]) {
  const retryAfter = failures
    .map((failure) => (failure instanceof SpotifyRequestError ? failure.retryAfterSeconds : null))
    .filter((value): value is number => value !== null);
  const seconds = retryAfter.length > 0 ? Math.max(...retryAfter) : SPOTIFY_FAILURE_COOLDOWN_SECONDS;
  return Math.min(Math.max(seconds, 60), MAX_COOLDOWN_SECONDS);
}

export async function getSpotifyPlaylistTrackUpdates(now = Date.now()): Promise<SpotifyPlaylistTrackUpdate[]> {
  const cached = await readJson<CachedUpdates>(SPOTIFY_UPDATES_CACHE_KEY);

  if (cached && now - cached.fetchedAt < SPOTIFY_UPDATES_FRESH_SECONDS * 1000) {
    return cached.tracks;
  }

  const cooldown = await readJson<{ until: number }>(SPOTIFY_COOLDOWN_CACHE_KEY);
  if (cooldown && now < cooldown.until) {
    console.warn(
      `Spotify is cooling down until ${new Date(cooldown.until).toISOString()}; ` +
        (cached ? "serving the last good playlist updates." : "no good copy to serve."),
    );
    return cached?.tracks ?? [];
  }

  let result: PlaylistUpdatesResult | null;
  try {
    result = await fetchSpotifyPlaylistTrackUpdates();
  } catch (error) {
    // The token request itself failed.
    result = { tracks: [], failures: [error] };
  }

  if (!result) {
    // Not configured (no credentials or refresh token): nothing to fetch.
    return cached?.tracks ?? [];
  }

  if (result.failures.length === 0) {
    await writeJson(
      SPOTIFY_UPDATES_CACHE_KEY,
      { fetchedAt: now, tracks: result.tracks } satisfies CachedUpdates,
      SPOTIFY_UPDATES_STALE_SECONDS,
    );
    return result.tracks;
  }

  // Never store a failed or partial result over a good one.
  const wait = cooldownSeconds(result.failures);
  await writeJson(SPOTIFY_COOLDOWN_CACHE_KEY, { until: now + wait * 1000 }, wait);

  if (cached) {
    console.warn(`Spotify playlist updates failed; serving the copy from ${new Date(cached.fetchedAt).toISOString()}.`);
    return cached.tracks;
  }

  return result.tracks;
}
