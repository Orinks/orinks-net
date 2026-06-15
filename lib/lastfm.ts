export type LastFmTrackUpdate = {
  title: string;
  description: string;
  href?: string;
  source: string;
  publishedAt: string;
  kind: "track";
};

type LastFmTextValue = {
  "#text"?: string;
};

type LastFmRecentTrack = {
  name?: string;
  artist?: LastFmTextValue;
  album?: LastFmTextValue;
  url?: string;
  date?: {
    uts?: string;
    "#text"?: string;
  };
  "@attr"?: {
    nowplaying?: string;
  };
};

type LastFmRecentTracksResponse = {
  recenttracks?: {
    track?: LastFmRecentTrack | LastFmRecentTrack[];
  };
};

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_TIMEOUT_MS = 5000;

function asTrackArray(track: LastFmRecentTrack | LastFmRecentTrack[] | undefined) {
  if (!track) {
    return [];
  }

  return Array.isArray(track) ? track : [track];
}

function unixSecondsToISOString(value: string | undefined) {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);

  if (Number.isNaN(seconds)) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function trackDescription(track: LastFmRecentTrack) {
  const artist = track.artist?.["#text"]?.trim();
  const album = track.album?.["#text"]?.trim();

  if (artist && album) {
    return `${artist} from ${album}`;
  }

  if (artist) {
    return artist;
  }

  return "Recent Last.fm scrobble";
}

export async function getRecentLastFmTracks(): Promise<LastFmTrackUpdate[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  const username = process.env.LASTFM_USERNAME;

  if (!apiKey || !username) {
    return [];
  }

  const params = new URLSearchParams({
    method: "user.getRecentTracks",
    user: username,
    api_key: apiKey,
    format: "json",
    limit: "10",
  });

  const response = await fetch(`${LASTFM_API_URL}?${params.toString()}`, {
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Last.fm recent tracks request failed: ${response.status}`);
  }

  const payload = (await response.json()) as LastFmRecentTracksResponse;

  return asTrackArray(payload.recenttracks?.track)
    .filter((track) => track["@attr"]?.nowplaying !== "true")
    .flatMap((track) => {
      const publishedAt = unixSecondsToISOString(track.date?.uts);

      if (!track.name?.trim() || !publishedAt) {
        return [];
      }

      return [
        {
          title: track.name.trim(),
          description: trackDescription(track),
          href: track.url,
          source: "Last.fm",
          publishedAt,
          kind: "track" as const,
        },
      ];
    })
    .slice(0, 5);
}
