import { PageHeader } from "@/components/PageHeader";
import { RecentUpdates } from "@/components/RecentUpdates";
import { formatAnnouncementDate, getWhatsNewEntries, type WhatsNewEntry } from "@/lib/whats-new";

export const metadata = {
  title: "What's New",
  description:
    "Announcements and recent activity across the site, the games, and the featured projects.",
};

// The 10 newest stay expanded and reachable by heading navigation; older
// entries live in one native disclosure (a11y consult).
const EXPANDED_COUNT = 10;

function Announcement({ entry }: { entry: WhatsNewEntry }) {
  return (
    <article className="rounded-lg border border-line bg-white p-5">
      <h3 className="text-xl font-bold text-ink" id={entry.id}>
        {entry.title}
      </h3>
      <p className="mt-1 text-sm font-semibold text-slate-600">
        {entry.project} · <time dateTime={entry.date}>{formatAnnouncementDate(entry.date)}</time>
      </p>
      {entry.body.map((paragraph, index) => (
        <p className="mt-3 leading-7 text-slate-700" key={index}>
          {paragraph}
        </p>
      ))}
      {entry.link ? (
        <p className="mt-3">
          <a className="font-semibold text-action hover:text-action-dark" href={entry.link.href}>
            {entry.link.label}
          </a>
        </p>
      ) : null}
    </article>
  );
}

export default function WhatsNewPage() {
  // getWhatsNewEntries throws on malformed data, so a bad entry fails the
  // build — and CI — before any deploy reaches dev or main.
  const entries = getWhatsNewEntries();
  const expanded = entries.slice(0, EXPANDED_COUNT);
  const older = entries.slice(EXPANDED_COUNT);

  return (
    <div className="space-y-4">
      <PageHeader
        intro="What changed lately: announcements for the site and its games, followed by public activity from the featured project repositories."
        title="What's New"
      />

      <section aria-labelledby="announcements" className="py-8">
        <h2 className="text-2xl font-bold text-ink" id="announcements">
          Announcements
        </h2>
        <div className="mt-4 space-y-4">
          {expanded.map((entry) => (
            <Announcement entry={entry} key={entry.id} />
          ))}
        </div>
        {older.length > 0 ? (
          // TODO(a11y review): when this archive goes live, deep links into a
          // closed <details> need an open-on-hash-match effect for browsers
          // without ancestor-details revealing.
          <details className="mt-4 rounded-lg border border-line bg-white p-5">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              {/* Heading inside the summary keeps the archive discoverable by
                  heading navigation, same as the feed categories. */}
              <h3 className="inline text-xl font-bold text-ink">
                Older announcements ({older.length})
              </h3>
            </summary>
            <div className="mt-4 space-y-4">
              {older.map((entry) => (
                <Announcement entry={entry} key={entry.id} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <RecentUpdates
        categoriesOpen
        headingId="from-the-repositories"
        includeLastFmTracks={false}
        includeMastodon={false}
        intro="Releases and commits from the featured project repositories — the same feed the homepage follows."
        title="From the repositories"
      />
    </div>
  );
}
