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

export async function renderMarkdown(body: string | null, repo: string) {
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
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

export async function getReleases(repo: string): Promise<GitHubRelease[]> {
  const response = await fetch(`https://api.github.com/repos/Orinks/${repo}/releases?per_page=20`, {
    headers: githubHeaders(),
    cache: "no-store",
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

  return (
    !ignoredCommitPrefixes.some((prefix) => title.startsWith(prefix)) &&
    !/^(chore|ci|style)\([^)]+\):/.test(title)
  );
}

async function getBranchCommits(repo: string, branch: string) {
  const response = await fetch(`https://api.github.com/repos/Orinks/${repo}/commits?sha=${branch}&per_page=10`, {
    headers: githubHeaders(),
    next: { revalidate: 1800 },
  });

  if (!response.ok) {
    throw new Error(`GitHub commits request failed for ${repo}/${branch}: ${response.status}`);
  }

  return ((await response.json()) as GitHubCommit[]).map((commit) => ({ branch, commit }));
}

export async function getRecentCommitActivity(repo: string): Promise<GitHubActivityItem[]> {
  const branchResults = await Promise.allSettled(["main", "dev"].map((branch) => getBranchCommits(repo, branch)));
  const seenShas = new Set<string>();
  const commits = branchResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return commits
    .filter(({ commit }) => {
      if (seenShas.has(commit.sha)) {
        return false;
      }

      seenShas.add(commit.sha);
      return commit.commit.author?.date && isMeaningfulCommit(commit.commit.message);
    })
    .sort(
      (a, b) =>
        new Date(b.commit.commit.author?.date ?? "").getTime() -
        new Date(a.commit.commit.author?.date ?? "").getTime(),
    )
    .slice(0, 2)
    .map(({ branch, commit }) => ({
      title: commitTitle(commit.commit.message),
      description: `${branch} branch update in ${repo}.`,
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
  return assets.filter((asset) => /\.(exe|msi|zip|dmg|pkg|appimage|deb|rpm|tar\.gz|tgz)$/i.test(asset.name));
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

  if (normalized.endsWith(".dmg")) {
    return `macOS disk image${architecture}`;
  }

  if (normalized.endsWith(".pkg")) {
    return `macOS installer package${architecture}`;
  }

  if ((normalized.includes("macos") || normalized.includes("darwin")) && normalized.endsWith(".zip")) {
    return `macOS ZIP archive${architecture}`;
  }

  if (normalized.endsWith(".appimage")) {
    return `Linux AppImage${architecture}`;
  }

  if (normalized.endsWith(".deb")) {
    return `Linux DEB package${architecture}`;
  }

  if (normalized.endsWith(".rpm")) {
    return `Linux RPM package${architecture}`;
  }

  if (
    (normalized.includes("macos") || normalized.includes("darwin")) &&
    (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz"))
  ) {
    return `macOS tarball${architecture}`;
  }

  if (
    (normalized.includes("linux") || normalized.includes("ubuntu")) &&
    (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz"))
  ) {
    return `Linux tarball${architecture}`;
  }

  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return `Tarball${architecture}`;
  }

  if (normalized.includes("portable")) {
    return `Windows portable${architecture}`;
  }

  if (normalized.endsWith(".msi") || normalized.includes("setup")) {
    return `Windows installer${architecture}`;
  }

  if (normalized.endsWith(".exe")) {
    return `Windows executable${architecture}`;
  }

  if ((normalized.includes("linux") || normalized.includes("ubuntu")) && normalized.endsWith(".zip")) {
    return `Linux ZIP archive${architecture}`;
  }

  if (normalized.endsWith(".zip")) {
    return `ZIP archive${architecture}`;
  }

  return assetName;
}
