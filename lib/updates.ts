import {
  getRecentCommitActivity,
  getRecentReleaseActivity,
  type GitHubActivityItem,
} from "@/lib/github";
import { getRecentLastFmTracks, type LastFmTrackUpdate } from "@/lib/lastfm";
import {
  getSpotifyPlaylistTrackUpdates,
  type SpotifyPlaylistTrackUpdate,
} from "@/lib/spotify";

export type UpdateItem = (GitHubActivityItem | LastFmTrackUpdate | SpotifyPlaylistTrackUpdate) & {
  kind: "release" | "commit" | "track" | "playlist-track";
};

export type UpdateCategory = {
  id: "code" | "music";
  title: string;
  defaultOpen: boolean;
  items: UpdateItem[];
  unavailableMessage?: string;
};

const featuredRepos = ["AccessiWeather", "PortkeyDrop"];

type RecentUpdateOptions = {
  includeCode?: boolean;
  includeLastFmTracks?: boolean;
  includeSpotifyPlaylists?: boolean;
};

function sortByNewest(items: UpdateItem[]) {
  return [...items].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

async function getCodeItems() {
  const repoResults = await Promise.allSettled(
    featuredRepos.flatMap((repo) => [getRecentReleaseActivity(repo), getRecentCommitActivity(repo)]),
  );

  return repoResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function getMusicItems({
  includeLastFmTracks = true,
  includeSpotifyPlaylists = false,
}: RecentUpdateOptions = {}) {
  const playlistTracks = includeSpotifyPlaylists ? await getSpotifyPlaylistTrackUpdates() : [];
  if (!includeLastFmTracks) {
    return playlistTracks;
  }

  try {
    const tracks = await getRecentLastFmTracks();
    return [...tracks, ...playlistTracks];
  } catch {
    return playlistTracks;
  }
}

export async function getRecentUpdateCategories({
  includeCode = true,
  includeLastFmTracks = true,
  includeSpotifyPlaylists = false,
}: RecentUpdateOptions = {}): Promise<UpdateCategory[]> {
  const [codeItems, musicItems] = await Promise.all([
    includeCode ? getCodeItems() : Promise.resolve([]),
    getMusicItems({ includeLastFmTracks, includeSpotifyPlaylists }),
  ]);

  const categories: UpdateCategory[] = [];

  if (includeCode) {
    categories.push({
      id: "code",
      title: "Code updates",
      defaultOpen: false,
      items: sortByNewest(codeItems).slice(0, 5),
      unavailableMessage: "Code updates are temporarily unavailable.",
    });
  }

  categories.push({
    id: "music",
    title: "Music updates",
    defaultOpen: includeSpotifyPlaylists,
    items:
      includeSpotifyPlaylists && !includeLastFmTracks
        ? musicItems.slice(0, 10)
        : sortByNewest(musicItems).slice(0, includeSpotifyPlaylists ? 10 : 5),
    unavailableMessage: includeSpotifyPlaylists
      ? "Spotify playlist updates are temporarily unavailable."
      : process.env.LASTFM_API_KEY && process.env.LASTFM_USERNAME
        ? "Music updates are temporarily unavailable."
        : "Music updates need Last.fm credentials before they can appear here.",
  });

  return categories;
}
