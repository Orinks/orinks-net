import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FreightFatePaperEdition, PaperEarlierIssues } from "@/components/FreightFatePaperEdition";
import {
  PAPER_CHROME,
  PAPER_NAME,
  getPaperGameNews,
  paperWhen,
  readPaperEdition,
  readPaperListings,
} from "@/lib/freight-fate-paper-page";
import { PAPER_HREF, buildPaperView, earlierIssues } from "@/lib/freight-fate-paper-view";

// Shared by /freight-fate/news (the latest edition) and /freight-fate/news/N.

export const PAPER_FEED_ALTERNATE = {
  types: { "application/rss+xml": [{ url: "/freight-fate/news/feed.xml", title: PAPER_NAME }] },
};

/** "12" is an issue; anything else, including "012", is not. */
export function parseIssue(raw: string) {
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : null;
}

export async function paperMetadata(issue?: number): Promise<Metadata> {
  const read = await readPaperEdition(issue);
  const edition = read.ok ? read.value : null;
  return {
    title: edition ? `${PAPER_NAME}, issue ${edition.issue}` : PAPER_NAME,
    description: "The weekly paper about Freight Fate drivers.",
    alternates: PAPER_FEED_ALTERNATE,
  };
}

export async function PaperEditionPage({ issue }: { issue?: number }) {
  const [read, listings] = await Promise.all([readPaperEdition(issue), readPaperListings()]);
  if (!read.ok) {
    return (
      <>
        <header className="border-b border-line pb-8">
          <h1 className="text-4xl font-bold text-ink sm:text-5xl" tabIndex={-1}>{PAPER_NAME}</h1>
        </header>
        <p className="py-8 text-lg">The paper can&apos;t be shown right now. Check back in a few minutes.</p>
      </>
    );
  }
  const edition = read.value;
  if (!edition) notFound();
  const published = listings.ok ? listings.value ?? [] : [];
  const latestIssue = published.filter((row) => row.state === "published")
    .reduce((top, row) => Math.max(top, row.issue), edition.issue);
  const latest = issue === undefined || edition.issue === latestIssue;
  const gameNews = await getPaperGameNews(paperWhen(edition.periodStart, edition.periodEnd));
  const view = buildPaperView(edition, PAPER_CHROME, { latest: issue === undefined, gameNews });
  const earlier = earlierIssues(published, edition.issue);
  return (
    <FreightFatePaperEdition title={`${PAPER_NAME}, issue ${edition.issue}`} view={view}>
      <PaperEarlierIssues issues={earlier.issues} latestHref={latest ? undefined : PAPER_HREF} olderHref={earlier.olderHref} />
    </FreightFatePaperEdition>
  );
}
