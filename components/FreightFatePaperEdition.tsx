import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { PaperTextSegment } from "@/lib/freight-fate-paper-text";
import type { PaperView, PaperViewSection, PaperViewTable } from "@/lib/freight-fate-paper-view";

// One edition of the driver newspaper, as a document: the masthead is the
// page's h1, each section an h2, each story an h3 and its paragraph. No
// article elements, no table of contents, one column (accessibility review,
// 2026-11-22). Pure markup, so the owner's preview can draw it in the browser.

export function PaperSegments({ segments }: { segments: PaperTextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => ("text" in segment
        ? <Fragment key={index}>{segment.text}</Fragment>
        : (
          <Link className="text-action underline" href={`/freight-fate/drivers/${segment.driverId}`} key={index}>
            {segment.displayName}
          </Link>
        )))}
    </>
  );
}

function PaperTable({ table, scrolls }: { table: PaperViewTable; scrolls: boolean }) {
  const content = (
    <table className="w-full border-collapse text-left">
      <caption className="mb-2 text-left font-semibold" id={table.id}>{table.caption}</caption>
      <thead>
        <tr className="border-b border-line-strong">
          {table.columns.map((column) => <th className="py-2 pr-4" key={column} scope="col">{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr className="border-b border-line align-top" key={row.header}>
            <th className="py-2 pr-4 font-semibold" scope="row">{row.header}</th>
            {row.cells.map((cell, index) => (
              <td className="py-2 pr-4" key={index}><PaperSegments segments={[cell]} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!scrolls) return content;
  // Only the wide table scrolls sideways, so only it is a stop for the
  // keyboard. The padding keeps focus rings on edge links inside the clip.
  return (
    <div
      aria-labelledby={table.id}
      className="overflow-x-auto p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      role="region"
      tabIndex={0}
    >
      <div className="min-w-[36rem]">{content}</div>
    </div>
  );
}

function PaperSection({ section }: { section: PaperViewSection }) {
  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-bold text-ink">
        {section.heading}
        {section.headingDay ? <>, <time dateTime={section.headingDay.iso}>{section.headingDay.label}</time></> : null}
      </h2>
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold">
        {section.paragraphs?.map((paragraph, index) => (
          <p key={index}>
            {section.asOf && index === 0
              ? <>As of <time dateTime={section.asOf.iso}>{section.asOf.label}</time>: </>
              : null}
            <PaperSegments segments={paragraph} />
          </p>
        ))}
        {section.table
          ? <PaperTable scrolls={section.table.columns.length > 3} table={section.table} />
          : null}
        {section.stories.map((story) => (
          <div key={story.id}>
            <h3><PaperSegments segments={story.headline} /></h3>
            <p>
              <PaperSegments segments={story.body} />
              {story.link ? <> <a href={story.link.href}>{story.link.label}</a></> : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FreightFatePaperEdition({ view, title, children }: { view: PaperView; title: string; children?: ReactNode }) {
  return (
    <>
      <header className="border-b border-line pb-8">
        <h1 className="max-w-4xl text-4xl font-bold text-ink sm:text-5xl" tabIndex={-1}>{title}</h1>
        <p className="mt-4 text-lg text-slate-700">
          <time dateTime={view.firstDay.iso}>{view.firstDay.label}</time>
          {" to "}
          <time dateTime={view.lastDay.iso}>{view.lastDay.label}</time>
        </p>
      </header>
      {view.sections.map((section) => <PaperSection key={section.key} section={section} />)}
      {view.backPage ? (
        <section className="py-8">
          <h2 className="mb-4 text-2xl font-bold text-ink">{view.backPage.heading}</h2>
          <div className="prose prose-slate max-w-none">
            {view.backPage.pieces.map((piece) => (
              <div key={piece.id}>
                <h3>{piece.title}</h3>
                {piece.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {children}
    </>
  );
}

/** The earlier-issues list at the end of an edition. */
export function PaperEarlierIssues({ issues, olderHref, latestHref }: {
  issues: Array<{ issue: number; href: string; label: string }>;
  olderHref: string | null;
  latestHref?: string;
}) {
  if (issues.length === 0 && !latestHref) return null;
  return (
    <nav aria-labelledby="paper-earlier-issues" className="py-8">
      <h2 className="mb-4 text-2xl font-bold text-ink" id="paper-earlier-issues">Earlier issues</h2>
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold">
        {issues.length > 0 ? (
          <ul>{issues.map((row) => <li key={row.issue}><Link href={row.href}>{row.label}</Link></li>)}</ul>
        ) : null}
        {olderHref ? <p><Link href={olderHref}>Older issues</Link></p> : null}
        {latestHref ? <p><Link href={latestHref}>Latest issue</Link></p> : null}
      </div>
    </nav>
  );
}
