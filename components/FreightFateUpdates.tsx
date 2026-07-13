import Link from "next/link";
import { FreightFateEventLink } from "@/components/FreightFateEventLink";
import { freightFateEventFragment } from "@/lib/freight-fate-fragments";
import { getFreightFatePublicUpdates } from "@/lib/freight-fate-online";

export type UpdatesCursor = { occurredAt: number; eventId: string };
type PublicUpdate = {
  _id: string; driverId: string; displayName: string; eventId: string;
  eventType: string; summary: string; occurredAt: number;
};

export function parseUpdatesCursor(value: string | undefined): UpdatesCursor | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  if (separator < 1) return undefined;
  const occurredAt = Number(value.slice(0, separator));
  const eventId = value.slice(separator + 1);
  return Number.isSafeInteger(occurredAt) && eventId.length > 0 && eventId.length <= 96
    ? { occurredAt, eventId }
    : undefined;
}

function Time({ value }: { value: number }) {
  const visible = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long", timeStyle: "long", timeZone: "America/New_York", timeZoneName: undefined,
  }).format(new Date(value));
  return <time dateTime={new Date(value).toISOString()}>{visible}</time>;
}

function eventLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export async function FreightFateUpdates({ cursor, limit = 10, compact = false }: {
  cursor?: UpdatesCursor; limit?: number; compact?: boolean;
}) {
  let result = null;
  try {
    result = await getFreightFatePublicUpdates(limit, cursor);
  } catch {
    result = null;
  }
  const content = <>
      <p className="mb-5 max-w-3xl">Newest updates first.</p>
      {!result ? <p>Freight Fate updates are temporarily unavailable.</p> : result.updates.length === 0 ? (
        <p>No Freight Fate updates yet.</p>
      ) : (
        <ol className="space-y-4">
          {result.updates.map((event: PublicUpdate) => {
            const headingId = `update-${freightFateEventFragment(`${event.driverId}:${event.eventId}`)}`;
            return <li key={event._id}>
              <article aria-labelledby={headingId} className="rounded border border-line-strong p-4">
                <h3 className="text-lg font-bold" id={headingId}>
                  <Link href={`/freight-fate/drivers/${event.driverId}`}>{event.displayName}</Link>
                  {`: ${eventLabel(event.eventType)}`}
                </h3>
                <p>
                  <FreightFateEventLink
                    fragment={freightFateEventFragment(event.eventId)}
                    href={`/freight-fate/drivers/${event.driverId}/road-journal`}
                  >
                    {event.summary}
                  </FreightFateEventLink>
                </p>
                <p className="text-slate-700"><Time value={event.occurredAt} /></p>
              </article>
            </li>;
          })}
        </ol>
      )}
      {cursor || result?.nextBefore || compact ? (
      <nav aria-label="Updates pagination" className="mt-6 flex flex-wrap gap-4">
        {cursor ? <Link href="/freight-fate/updates">Back to newest updates</Link> : null}
        {result?.nextBefore ? (
          <Link href={`/freight-fate/updates?before=${encodeURIComponent(`${result.nextBefore.occurredAt}:${result.nextBefore.eventId}`)}`}>Older updates</Link>
        ) : null}
        {compact ? <Link href="/freight-fate/updates">View all Freight Fate updates</Link> : null}
      </nav>
      ) : null}
    </>;
  if (compact) {
    return <section aria-labelledby="public-driver-updates-heading" className="my-8">
      <h2 className="mb-4 text-2xl font-bold text-ink" id="public-driver-updates-heading">Driver updates</h2>
      <details className="rounded-lg border border-line bg-white p-5">
        <summary className="cursor-pointer font-semibold text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-600">
          Freight Fate updates
        </summary>
        <div className="mt-5">{content}</div>
      </details>
    </section>;
  }
  return <section aria-labelledby="freight-fate-updates-heading" className="py-8">
    <h2 className="mb-4 text-2xl font-bold text-ink" id="freight-fate-updates-heading">Freight Fate updates</h2>
    {content}
  </section>;
}
