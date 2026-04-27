# Recent Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage-only recent updates section with expandable code and music categories sourced from GitHub and Last.fm.

**Architecture:** Keep API fetching in server-side library helpers, normalize all source records into a small shared update model, and render the homepage UI with a focused server component using native `<details>` disclosures. External API failures are contained inside source helpers so the homepage still renders.

**Tech Stack:** Next.js app router, React server components, TypeScript, Tailwind CSS, GitHub REST API, Last.fm REST API.

---

## File Structure

- Create `lib/updates.ts`: owns shared update types, category assembly, sorting, limits, and fallback category state.
- Create `lib/lastfm.ts`: owns Last.fm recent-track fetching and normalization.
- Modify `lib/github.ts`: add public helpers for recent releases and default-branch commits while reusing existing headers.
- Create `components/RecentUpdates.tsx`: renders the homepage section and expandable categories.
- Modify `app/page.tsx`: imports and renders `RecentUpdates` above featured projects.
- Modify `.env.example`: documents optional `LASTFM_API_KEY` and `LASTFM_USERNAME`.

No new dependencies are needed.

---

### Task 1: Add GitHub Activity Helpers

**Files:**
- Modify: `lib/github.ts`

- [ ] **Step 1: Add GitHub commit and update types**

Add these types below `GitHubRelease`:

```ts
export type GitHubCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string | null;
      date: string | null;
    } | null;
  };
};

export type GitHubActivityItem = {
  title: string;
  description: string;
  href: string;
  source: string;
  publishedAt: string;
  kind: "release" | "commit";
};
```

- [ ] **Step 2: Add recent release helper**

Add this function after `getReleases`:

```ts
export async function getRecentReleaseActivity(repo: string): Promise<GitHubActivityItem[]> {
  const releases = await getReleases(repo);

  return releases.slice(0, 3).flatMap((release) => {
    if (!release.published_at) {
      return [];
    }

    return [
      {
        title: releaseTitle(release),
        description: release.prerelease
          ? `Prerelease published for ${repo}.`
          : `Stable release published for ${repo}.`,
        href: release.html_url,
        source: `GitHub: ${repo}`,
        publishedAt: release.published_at,
        kind: "release" as const,
      },
    ];
  });
}
```

- [ ] **Step 3: Add default-branch commit helper**

Add these helpers near `getRecentReleaseActivity`:

```ts
const ignoredCommitPrefixes = ["chore:", "ci:", "style:"];

function commitTitle(message: string) {
  return message.split("\n")[0]?.trim() || "Repository update";
}

function isMeaningfulCommit(message: string) {
  const title = commitTitle(message).toLowerCase();

  return !ignoredCommitPrefixes.some((prefix) => title.startsWith(prefix));
}

export async function getRecentCommitActivity(repo: string): Promise<GitHubActivityItem[]> {
  const response = await fetch(`https://api.github.com/repos/Orinks/${repo}/commits?per_page=10`, {
    headers: githubHeaders(),
    next: { revalidate: 1800 },
  });

  if (!response.ok) {
    throw new Error(`GitHub commits request failed for ${repo}: ${response.status}`);
  }

  const commits = (await response.json()) as GitHubCommit[];

  return commits
    .filter((commit) => commit.commit.author?.date && isMeaningfulCommit(commit.commit.message))
    .slice(0, 2)
    .map((commit) => ({
      title: commitTitle(commit.commit.message),
      description: `Default branch update in ${repo}.`,
      href: commit.html_url,
      source: `GitHub: ${repo}`,
      publishedAt: commit.commit.author?.date ?? "",
      kind: "commit" as const,
    }));
}
```

- [ ] **Step 4: Run typecheck for helper signatures**

Run: `npm run typecheck`

Expected: TypeScript reports no errors from `lib/github.ts`.

---

### Task 2: Add Last.fm Recent Track Helper

**Files:**
- Create: `lib/lastfm.ts`

- [ ] **Step 1: Create Last.fm response types and fetch helper**

Create `lib/lastfm.ts` with:

```ts
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
```

- [ ] **Step 2: Add normalizers**

Append:

```ts
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
```

- [ ] **Step 3: Add exported recent-track function**

Append:

```ts
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
```

- [ ] **Step 4: Run typecheck for Last.fm helper**

Run: `npm run typecheck`

Expected: TypeScript reports no errors from `lib/lastfm.ts`.

---

### Task 3: Add Update Aggregator

**Files:**
- Create: `lib/updates.ts`

- [ ] **Step 1: Define shared update model**

Create `lib/updates.ts` with:

```ts
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
  summary: string;
  defaultOpen: boolean;
  items: UpdateItem[];
  unavailableMessage?: string;
};

const featuredRepos = ["AccessiWeather", "PortkeyDrop"];
```

- [ ] **Step 2: Add sorting and source isolation helpers**

Append:

```ts
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
```

- [ ] **Step 3: Add exported category assembler**

Append:

```ts
export async function getRecentUpdateCategories(): Promise<UpdateCategory[]> {
  const [codeItems, musicItems] = await Promise.all([getCodeItems(), getMusicItems()]);

  return [
    {
      id: "code",
      title: "Code updates",
      summary: "Higher-signal project activity from featured GitHub repositories.",
      defaultOpen: true,
      items: sortByNewest(codeItems).slice(0, 5),
      unavailableMessage: "Code updates are temporarily unavailable.",
    },
    {
      id: "music",
      title: "Music updates",
      summary: "Recent tracks scrobbled through Last.fm.",
      defaultOpen: musicItems.length > 0,
      items: sortByNewest(musicItems).slice(0, 5),
      unavailableMessage: process.env.LASTFM_API_KEY && process.env.LASTFM_USERNAME
        ? "Music updates are temporarily unavailable."
        : "Music updates need Last.fm credentials before they can appear here.",
    },
  ];
}
```

- [ ] **Step 4: Run typecheck for aggregator**

Run: `npm run typecheck`

Expected: TypeScript reports no errors from `lib/updates.ts`.

---

### Task 4: Render Recent Updates on Homepage

**Files:**
- Create: `components/RecentUpdates.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create the component**

Create `components/RecentUpdates.tsx` with:

```tsx
import { getRecentUpdateCategories, type UpdateItem } from "@/lib/updates";

function formatUpdateDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

function kindLabel(kind: UpdateItem["kind"]) {
  switch (kind) {
    case "release":
      return "Release";
    case "commit":
      return "Commit";
    case "track":
      return "Track";
  }
}

function UpdateRow({ item }: { item: UpdateItem }) {
  const title = item.href ? (
    <a className="text-action hover:text-action-dark" href={item.href}>
      {item.title}
    </a>
  ) : (
    item.title
  );

  return (
    <li className="border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-base font-bold text-ink">{title}</h4>
        <p className="text-sm font-semibold text-slate-600">
          {kindLabel(item.kind)} · {item.source} · {formatUpdateDate(item.publishedAt)}
        </p>
      </div>
      <p className="mt-1 leading-7 text-slate-700">{item.description}</p>
    </li>
  );
}

export async function RecentUpdates() {
  const categories = await getRecentUpdateCategories();

  return (
    <section className="py-8" aria-labelledby="recent-updates">
      <div className="mb-4 max-w-3xl">
        <h2 className="text-2xl font-bold text-ink" id="recent-updates">
          Recent updates
        </h2>
        <p className="mt-2 leading-7 text-slate-700">
          Public activity from featured projects and recent music scrobbles.
        </p>
      </div>

      <div className="space-y-4">
        {categories.map((category) => (
          <details
            className="rounded-lg border border-line bg-white p-5"
            key={category.id}
            open={category.defaultOpen}
          >
            <summary className="cursor-pointer list-none text-xl font-bold text-ink [&::-webkit-details-marker]:hidden">
              {category.title}
            </summary>
            <p className="mt-2 leading-7 text-slate-700">{category.summary}</p>
            {category.items.length > 0 ? (
              <ul className="mt-4 p-0">
                {category.items.map((item) => (
                  <UpdateRow key={`${item.kind}-${item.source}-${item.publishedAt}-${item.title}`} item={item} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-md border border-line bg-slate-50 p-4 text-slate-700">
                {category.unavailableMessage}
              </p>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add component to homepage**

In `app/page.tsx`, add:

```tsx
import { RecentUpdates } from "@/components/RecentUpdates";
```

Then render below the intro `Section` and above the featured projects section:

```tsx
<RecentUpdates />
```

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint`

Expected: no lint errors.

Run: `npm run typecheck`

Expected: no type errors.

---

### Task 5: Document Environment Variables and Verify Build

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Last.fm env vars**

Append to `.env.example`:

```env
LASTFM_API_KEY=""
LASTFM_USERNAME=""
```

- [ ] **Step 2: Build without optional credentials**

Run: `npm run build`

Expected: build succeeds. The homepage must render even when `LASTFM_API_KEY`, `LASTFM_USERNAME`, and `GITHUB_TOKEN` are empty.

- [ ] **Step 3: Final status check**

Run: `git --no-pager status --short`

Expected: modified files are limited to:

```text
 M .env.example
 M app/page.tsx
 M lib/github.ts
?? components/RecentUpdates.tsx
?? lib/lastfm.ts
?? lib/updates.ts
```

---

## Self-Review

- Spec coverage: homepage-only UI, code category, music category, optional credentials, source failure isolation, no blog dependency, no Spotify dependency, no new dependencies, and verification are all covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `UpdateItem.kind` values are `release`, `commit`, and `track` throughout; category ids are `code` and `music`; env var names match the design spec.
