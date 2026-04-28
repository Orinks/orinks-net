import {
  getRecentCommitActivity,
  getRecentReleaseActivity,
  type GitHubActivityItem,
} from "@/lib/github";
import { getRecentLastFmTracks, type LastFmTrackUpdate } from "@/lib/lastfm";

export type UpdateItem = (GitHubActivityItem | LastFmTrackUpdate) & {
  kind: "release" | "commit" | "track";
};

export type UpdateCategory = {
  id: "code" | "music";
  title: string;
  defaultOpen: boolean;
  items: UpdateItem[];
  unavailableMessage?: string;
};

const featuredRepos = ["AccessiWeather", "PortkeyDrop"];

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

async function getMusicItems() {
  try {
    return await getRecentLastFmTracks();
  } catch {
    return [];
  }
}

export async function getRecentUpdateCategories(): Promise<UpdateCategory[]> {
  const [codeItems, musicItems] = await Promise.all([getCodeItems(), getMusicItems()]);

  return [
    {
      id: "code",
      title: "Code updates",
      defaultOpen: false,
      items: sortByNewest(codeItems).slice(0, 5),
      unavailableMessage: "Code updates are temporarily unavailable.",
    },
    {
      id: "music",
      title: "Music updates",
      defaultOpen: false,
      items: sortByNewest(musicItems).slice(0, 5),
      unavailableMessage:
        process.env.LASTFM_API_KEY && process.env.LASTFM_USERNAME
          ? "Music updates are temporarily unavailable."
          : "Music updates need Last.fm credentials before they can appear here.",
    },
  ];
}
