import { notFound } from "next/navigation";
import { FreightFateEventLink } from "@/components/FreightFateEventLink";
import { FreightFateHashFocus } from "@/components/FreightFateHashFocus";
import { PageHeader } from "@/components/PageHeader";
import { freightFateEventFragment } from "@/lib/freight-fate-fragments";

const events = [
  { id: "delivery #2?", summary: "Delivered steel from Chicago to Denver." },
  { id: "delivery %1", summary: "Delivered produce from Omaha to Chicago." },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; before?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  if (query.view === "journal") {
    return (
      <div className="space-y-8">
        <PageHeader title="E2E Driver" intro="Deterministic local accessibility fixture." />
        <FreightFateHashFocus />
        <h2 className="text-2xl font-bold">Road journal</h2>
        <ol>{events.map((event) => {
          const fragment = freightFateEventFragment(event.id);
          return <li key={event.id}><h3 id={fragment} tabIndex={-1}>{event.summary}</h3></li>;
        })}</ol>
        <nav aria-label="Road journal pagination">
          {query.before ? <a href="/freight-fate/e2e-fixture?view=journal">Back to newest road-journal entries</a> : <a href="/freight-fate/e2e-fixture?view=journal&before=older">Older road-journal entries</a>}
        </nav>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <PageHeader title="E2E Freight Fate Updates" />
      <h2>Newest first</h2>
      <ol>{events.map((event) => <li key={event.id}>
        <FreightFateEventLink fragment={freightFateEventFragment(event.id)} href="/freight-fate/e2e-fixture?view=journal">
          {event.summary}
        </FreightFateEventLink>
      </li>)}</ol>
    </div>
  );
}
