import { getRecentUpdateCategories, type UpdateItem } from "@/lib/updates";

function formatUpdateDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

function formatScrobbleDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(date));
}

function updateTimestamp(item: UpdateItem) {
  if (item.kind === "track") {
    return `Scrobbled ${formatScrobbleDate(item.publishedAt)}`;
  }

  if (item.kind === "playlist-track") {
    return `Added ${formatScrobbleDate(item.publishedAt)}`;
  }

  if (item.kind === "mastodon-post") {
    return `Posted ${formatScrobbleDate(item.publishedAt)}`;
  }

  return formatUpdateDate(item.publishedAt);
}

function kindLabel(kind: UpdateItem["kind"]) {
  switch (kind) {
    case "release":
      return "Release";
    case "commit":
      return "Commit";
    case "track":
      return "Track";
    case "playlist-track":
      return "Playlist add";
    case "mastodon-post":
      return "Post";
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
          {kindLabel(item.kind)} · {item.source} · {updateTimestamp(item)}
        </p>
      </div>
      <p className="mt-1 leading-7 text-slate-700">{item.description}</p>
    </li>
  );
}

type RecentUpdatesProps = {
  includeCode?: boolean;
  includeLastFmTracks?: boolean;
  includeMastodon?: boolean;
  includeSpotifyPlaylists?: boolean;
  intro?: string;
  /** Section heading text; parameterized so other pages can host the feed. */
  title?: string;
  /** Section heading id — must be unique per page (a11y review). */
  headingId?: string;
  /** Open every category disclosure — for pages showing a single category. */
  categoriesOpen?: boolean;
};

export async function RecentUpdates({
  includeCode = true,
  includeLastFmTracks = true,
  includeMastodon = true,
  includeSpotifyPlaylists = false,
  intro = "Public activity from featured projects, recent music scrobbles, and Mastodon posts.",
  title = "Recent updates",
  headingId = "recent-updates",
  categoriesOpen = false,
}: RecentUpdatesProps = {}) {
  const categories = await getRecentUpdateCategories({
    includeCode,
    includeLastFmTracks,
    includeMastodon,
    includeSpotifyPlaylists,
  });

  return (
    <section className="py-8" aria-labelledby={headingId}>
      <div className="mb-4 max-w-3xl">
        <h2 className="text-2xl font-bold text-ink" id={headingId}>
          {title}
        </h2>
        <p className="mt-2 leading-7 text-slate-700">{intro}</p>
      </div>

      <div className="space-y-4">
        {categories.map((category) => (
          <details
            className="rounded-lg border border-line bg-white p-5"
            key={category.id}
            open={categoriesOpen || category.defaultOpen}
          >
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              {/* Heading inside the summary keeps category names reachable by
                  heading navigation (h2 → h3 → h4, no skipped level). */}
              <h3 className="inline text-xl font-bold text-ink">{category.title}</h3>
            </summary>
            {category.items.length > 0 ? (
              <ul className="mt-4 p-0">
                {category.items.map((item) => (
                  <UpdateRow
                    item={item}
                    key={`${item.kind}-${item.source}-${item.publishedAt}-${item.title}`}
                  />
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
