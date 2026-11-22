import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PAPER_NAME, readPaperListings } from "@/lib/freight-fate-paper-page";
import { PAPER_HREF, earlierIssues } from "@/lib/freight-fate-paper-view";
import { PAPER_FEED_ALTERNATE, parseIssue } from "../paper-route";

// Rendered per request: the page is chosen by its query. The list under it
// is the paper's five-minute cached read.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ before?: string }> };

async function archivePage(searchParams: Props["searchParams"]) {
  const listings = await readPaperListings();
  if (!listings.ok || !listings.value) return null;
  const published = listings.value.filter((row) => row.state === "published");
  if (published.length === 0) return null;
  const latest = Math.max(...published.map((row) => row.issue));
  const before = parseIssue((await searchParams).before ?? "") ?? latest;
  const page = earlierIssues(published, Math.min(before, latest));
  return page.range ? page : null;
}

function rangeTitle(range: { newest: number; oldest: number }) {
  return range.newest === range.oldest
    ? `${PAPER_NAME}, issue ${range.newest}`
    : `${PAPER_NAME}, issues ${range.oldest} to ${range.newest}`;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = await archivePage(searchParams);
  // A 404 names no paper (see ../paper-route.tsx).
  if (!page?.range) return {};
  return { title: rangeTitle(page.range), alternates: PAPER_FEED_ALTERNATE };
}

export default async function FreightFateNewsArchivePage({ searchParams }: Props) {
  const page = await archivePage(searchParams);
  if (!page?.range) notFound();
  return (
    <>
      <header className="border-b border-line pb-8">
        <h1 className="max-w-4xl text-4xl font-bold text-ink sm:text-5xl" tabIndex={-1}>{rangeTitle(page.range)}</h1>
      </header>
      <div className="prose prose-slate max-w-none py-8 prose-a:text-action prose-a:font-semibold">
        <ul>{page.issues.map((row) => <li key={row.issue}><Link href={row.href}>{row.label}</Link></li>)}</ul>
        {page.newerHref ? <p><Link href={page.newerHref}>Newer issues</Link></p> : null}
        {page.olderHref ? <p><Link href={page.olderHref}>Older issues</Link></p> : null}
        <p><Link href={PAPER_HREF}>Latest issue</Link></p>
      </div>
    </>
  );
}
