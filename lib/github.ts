export type GitHubAsset = {
  name: string;
  browser_download_url: string;
  download_count: number;
};

export type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  body_html?: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  assets: GitHubAsset[];
};

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

const githubHeaders = (accept = "application/vnd.github+json") => {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
};

async function renderMarkdown(body: string | null, repo: string) {
  if (!body?.trim()) {
    return null;
  }

  const response = await fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: {
      ...githubHeaders("text/html"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: body,
      mode: "gfm",
      context: `Orinks/${repo}`,
    }),
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

export async function getReleases(repo: string): Promise<GitHubRelease[]> {
  const response = await fetch(`https://api.github.com/repos/Orinks/${repo}/releases?per_page=20`, {
    headers: githubHeaders(),
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed for ${repo}: ${response.status}`);
  }

  return response.json() as Promise<GitHubRelease[]>;
}

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

export async function getReleaseGroups(repo: string) {
  const releases = await getReleases(repo);
  const stable = releases.find(
    (release) => !release.prerelease && !release.tag_name.toLowerCase().startsWith("nightly"),
  );
  const nightlies = releases
    .filter((release) => release.prerelease || release.tag_name.toLowerCase().startsWith("nightly"))
    .slice(0, 5);

  const releasesWithRenderedNotes = await Promise.all(
    [stable, ...nightlies].filter((release): release is GitHubRelease => Boolean(release)).map(
      async (release) => ({
        ...release,
        body_html: await renderMarkdown(release.body, repo),
      }),
    ),
  );
  const renderedNotesByTag = new Map(
    releasesWithRenderedNotes.map((release) => [release.tag_name, release.body_html]),
  );

  return {
    stable: stable
      ? {
          ...stable,
          body_html: renderedNotesByTag.get(stable.tag_name) ?? null,
        }
      : undefined,
    nightlies: nightlies.map((release) => ({
      ...release,
      body_html: renderedNotesByTag.get(release.tag_name) ?? null,
    })),
  };
}

export function formatDate(date: string | null) {
  if (!date) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(date));
}

export function releaseTitle(release: GitHubRelease) {
  return release.name?.trim() || release.tag_name;
}

export function selectedDownloadAssets(assets: GitHubAsset[]) {
  return assets.filter((asset) => /\.(exe|msi|zip|dmg)$/i.test(asset.name));
}

export function downloadAssetLabel(assetName: string) {
  const normalized = assetName.toLowerCase();
  const architecture = normalized.includes("arm64")
    ? " ARM64"
    : normalized.includes("aarch64")
      ? " ARM64"
      : normalized.includes("x64") || normalized.includes("x86_64")
        ? " x64"
        : "";

  if (normalized.endsWith(".dmg") || normalized.includes("macos") || normalized.includes("darwin")) {
    return `macOS${architecture}`;
  }

  if (normalized.includes("portable")) {
    return `Windows portable${architecture}`;
  }

  if (normalized.endsWith(".msi") || normalized.endsWith(".exe") || normalized.includes("setup")) {
    return `Windows installer${architecture}`;
  }

  if (normalized.endsWith(".zip")) {
    return `Windows portable${architecture}`;
  }

  return assetName;
}
