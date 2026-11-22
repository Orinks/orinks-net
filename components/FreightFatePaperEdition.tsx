import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { PaperScrollRegion } from "./PaperScrollRegion";
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

// The three-column records table fits a 320px screen; the five-column
// standings table can be wider, so it sits in a region that becomes a Tab
// stop only while it overflows (PaperScrollRegion).
function PaperTable({ table }: { table: PaperViewTable }) {
  const content = (
    <table className="not-prose w-full border-collapse text-left">
      <caption className="mb-2 text-left font-semibold" id={table.id}>{table.caption}</caption>
      <thead>
        <tr className="border-b border-line-strong">
          {table.columns.map((column) => <th className="py-2 pr-2 align-bottom" key={column} scope="col">{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr className="border-b border-line align-top" key={row.header}>
            <th className="py-2 pr-2 font-semibold" scope="row">{row.header}</th>
            {row.cells.map((cell, index) => (
              <td className="py-2 pr-2" key={index}><PaperSegments segments={[cell]} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return table.columns.length > 3 ? <PaperScrollRegion labelledBy={table.id}>{content}</PaperScrollRegion> : content;
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
          ? <PaperTable table={section.table} />
          : null}
        {section.stories.map((story) => (
          <div key={story.id}>
            <h3><PaperSegments segments={story.headline} /></h3>
            {story.body.length > 0 || story.link ? (
              <p>
                <PaperSegments segments={story.body} />
                {story.link ? <>{story.body.length > 0 ? " " : null}<a href={story.link.href}>{story.link.label}</a></> : null}
              </p>
            ) : null}
            {story.list ? (
              <ul>{story.list.map((driver) => <li key={driver.driverId}><PaperSegments segments={[driver]} /></li>)}</ul>
            ) : null}
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
