import { ButtonLink } from "@/components/ButtonLink";
import {
  formatDate,
  getReleaseGroups,
  downloadAssetLabel,
  releaseTitle,
  selectedDownloadAssets,
  type GitHubRelease,
} from "@/lib/github";

type ReleaseDownloadsProps = {
  repo: "AccessiWeather" | "PortkeyDrop" | "station-scout" | "Freight-Fate" | "saltwake";
  productName: string;
};

function DownloadList({ release }: { release: GitHubRelease }) {
  const assets = selectedDownloadAssets(release.assets);
  const totalDownloads = assets.reduce((count, asset) => count + asset.download_count, 0);

  if (assets.length === 0) {
    return (
      <p>
        <a href={release.html_url}>View release assets on GitHub</a>
      </p>
    );
  }

  return (
    <ul className="grid gap-3 p-0 sm:grid-cols-2">
      {assets.map((asset) => (
        <li className="list-none" key={asset.browser_download_url}>
          <a
            className="block rounded-md border border-line bg-white px-4 py-3 font-semibold text-action hover:border-action hover:bg-sky-50 focus:outline-none focus:ring-4 focus:ring-sky-300"
            href={asset.browser_download_url}
          >
            {downloadAssetLabel(asset.name)}
          </a>
        </li>
      ))}
      <li className="list-none text-sm font-semibold text-slate-700 sm:col-span-2">
        Total downloads: {totalDownloads.toLocaleString("en-US")}
      </li>
    </ul>
  );
}

function Notes({ release }: { release: GitHubRelease }) {
  const body = release.body_html || release.body;

  if (!body?.trim()) {
    return null;
  }

  return (
    <details className="mt-5 rounded-md border border-line bg-white p-4">
      <summary className="cursor-pointer list-none font-semibold text-ink [&::-webkit-details-marker]:hidden">
        Release notes
      </summary>
      {release.body_html ? (
        <div
          className="prose mt-4 max-w-none text-sm leading-6 text-slate-700"
          dangerouslySetInnerHTML={{ __html: release.body_html }}
        />
      ) : (
        <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {body}
        </pre>
      )}
    </details>
  );
}

export async function ReleaseDownloads({ repo, productName }: ReleaseDownloadsProps) {
  try {
    const { stable, nightlies } = await getReleaseGroups(repo);

    return (
      <section className="space-y-6 py-8" aria-labelledby={`${repo.toLowerCase()}-downloads`}>
        <div>
          <h2 id={`${repo.toLowerCase()}-downloads`} className="text-2xl font-bold text-ink">
            Download {productName}
          </h2>
          <p className="mt-2 max-w-3xl text-slate-700">
            Download the latest stable release directly, or choose a nightly build for the newest
            fixes and features.
          </p>
        </div>

        {stable ? (
          <article className="rounded-lg border border-line bg-soft-green p-5">
            <p className="font-semibold text-emerald-900">Stable release</p>
            <h3 className="mt-1 text-xl font-bold text-ink">{releaseTitle(stable)}</h3>
            <p className="mt-1 text-sm text-slate-700">
              Published {formatDate(stable.published_at)}
            </p>
            <div className="mt-4">
              <DownloadList release={stable} />
            </div>
            <div className="mt-4">
              <ButtonLink href={stable.html_url} variant="secondary">
                View full release
              </ButtonLink>
            </div>
            <Notes release={stable} />
          </article>
        ) : (
          <p>No stable release was found on GitHub.</p>
        )}

        <div>
          <h3 className="mb-3 text-xl font-bold text-ink">Latest nightly builds</h3>
          <div className="space-y-4">
            {nightlies.map((release) => (
              <article className="rounded-lg border border-line bg-white p-5" key={release.tag_name}>
                <h4 className="text-lg font-bold text-ink">{releaseTitle(release)}</h4>
                <p className="mt-1 text-sm text-slate-700">
                  Published {formatDate(release.published_at)}
                </p>
                <div className="mt-4">
                  <DownloadList release={release} />
                </div>
                <p className="mt-4">
                  <a href={release.html_url}>Full release: {releaseTitle(release)}</a>
                </p>
                <Notes release={release} />
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GitHub error";

    return (
      <section className="rounded-lg border border-amber-300 bg-soft-gold p-5" role="status">
        <h2 className="text-xl font-bold text-ink">Downloads are temporarily unavailable</h2>
        <p className="mt-2 text-slate-800">{message}</p>
        <p className="mt-4">
          <a href={`https://github.com/Orinks/${repo}/releases`}>Open GitHub releases</a>
        </p>
      </section>
    );
  }
}
