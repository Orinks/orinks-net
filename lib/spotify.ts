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
};

export type SpotifyPlaylistTrackUpdate = {
  title: string;
  description: string;
  href: string;
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

  const token = await spotifyFetch<SpotifyTokenResponse>(SPOTIFY_ACCOUNTS_URL, {
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
    headers: {
      Authorization: createSpotifyAuthHeader(credentials.clientId, credentials.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  return token.access_token;
}

async function getPlaylistTrackUpdates(accessToken: string, playlist: (typeof playlists)[number]) {
  const fields =
    "items(added_at,item(name,type,external_urls.spotify,artists(name)))";
  const params = new URLSearchParams({
    fields,
    limit: "10",
    market: "US",
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

  return (data.items ?? []).flatMap((item): SpotifyPlaylistTrackUpdate[] => {
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
    updatePlaylists.map((playlist) => getPlaylistTrackUpdates(accessToken, playlist)),
  );

  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}
