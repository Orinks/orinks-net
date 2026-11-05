import { playlistUrl, playlists, updatePlaylists } from "@/lib/playlists";

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

async function spotifyFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const path = new URL(url).pathname;
    console.error(`Spotify request to ${path} failed: ${response.status} ${body.slice(0, 500)}`);
    throw new Error(`Spotify request failed: ${response.status}`);
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
        next: {
          revalidate: 1800,
        },
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

export async function getSpotifyPlaylistTrackUpdates() {
  const accessToken = await getSpotifyAccessToken();

  if (!accessToken) {
    return [];
  }

  const results = await Promise.allSettled(
    updatePlaylists.map(async (playlist) => ({
      playlist,
      tracks: await getPlaylistTrackUpdates(accessToken, playlist),
    })),
  );

  return results
    .flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return result.value.tracks;
      }

      const playlist = updatePlaylists[index];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Spotify playlist ${playlist?.id} (${playlist?.title}) failed: ${reason}`);
      return [];
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}
