import Link from "next/link";
import { FreightFateHashFocus } from "@/components/FreightFateHashFocus";
import { freightFateEventFragment } from "@/lib/freight-fate-fragments";
import { PageHeader } from "@/components/PageHeader";
import { getFreightFateDriverProfile, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export type ProfileSection = "overview" | "road-journal" | "achievements";
export type JournalCursor = { occurredAt: number; eventId: string };
type Event = { _id: string; eventId: string; eventType: string; summary: string; occurredAt: number };
type Achievement = { _id: string; name: string; description: string; earnedAt: number };

function Time({ value }: { value: number }) {
  const visible = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long", timeStyle: "long", timeZone: "America/New_York", timeZoneName: undefined,
  }).format(new Date(value));
  return <time dateTime={new Date(value).toISOString()}>{visible}</time>;
}

function ProfileNav({ driverId, section }: { driverId: string; section: ProfileSection }) {
  const root = `/freight-fate/drivers/${driverId}`;
  const links = [
    ["overview", root, "Profile overview"],
    ["road-journal", `${root}/road-journal`, "Road journal"],
    ["achievements", `${root}/achievements`, "Achievements"],
  ] as const;
  return (
    <nav aria-label="Freight Fate profile sections" className="border-b border-line-strong pb-4">
      <ul className="flex flex-wrap gap-3">
        {links.map(([key, href, label]) => (
          <li key={key}>
            <Link
              aria-current={section === key ? "page" : undefined}
              className="inline-block min-h-11 rounded border border-transparent px-3 py-2 font-semibold text-action underline aria-[current=page]:border-line-strong aria-[current=page]:bg-slate-100 aria-[current=page]:text-ink"
              href={href}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function safeProfile(driverId: string, cursor?: JournalCursor) {
  try {
    return await getFreightFateDriverProfile(normalizeFreightFateDriverId(driverId), 20, cursor);
  } catch {
    return null;
  }
}

export function parseJournalCursor(value: string | undefined): JournalCursor | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  if (separator < 1) return undefined;
  const occurredAt = Number(value.slice(0, separator));
  const eventId = value.slice(separator + 1);
  return Number.isSafeInteger(occurredAt) && eventId.length > 0 && eventId.length <= 96
    ? { occurredAt, eventId }
    : undefined;
}

function Unavailable() {
  return (
    <div className="space-y-8">
      <PageHeader title="Freight Fate Profile Unavailable" intro="This profile may be private, opted out, unavailable, or unknown." />
      <section aria-labelledby="profile-status-heading" className="py-4">
        <h2 className="mb-4 text-2xl font-bold text-ink" id="profile-status-heading">Profile status</h2>
        <p>orinks.net does not reveal driver details, statistics, journal entries, achievements, presence, or counts for unavailable profiles.</p>
      </section>
    </div>
  );
}

export async function DriverProfileView({ driverId: raw, section, cursor, confirmed = false }: {
  driverId: string; section: ProfileSection; cursor?: JournalCursor; confirmed?: boolean;
}) {
  const profile = await safeProfile(raw, cursor);
  if (!profile) return <Unavailable />;
  const { driver, snapshot } = profile;
  const root = `/freight-fate/drivers/${driver.driverId}`;
  return (
    <div className="space-y-8">
      <PageHeader title={driver.displayName} intro="A Freight Fate driver profile shared through orinks.net." />
      {confirmed ? <p className="rounded border border-line-strong bg-soft-green p-4">Expanded sharing is confirmed.</p> : null}
      <p>Shared profiles may appear in discovery. Shared facts describe the game, never the player&apos;s real-world location.</p>
      <ProfileNav driverId={driver.driverId} section={section} />

      {section === "overview" ? (
        <section aria-labelledby="overview-heading" className="py-4">
          <h2 className="mb-4 text-2xl font-bold text-ink" id="overview-heading">Overview</h2>
          {profile.presence ? (
            <p><strong>On duty:</strong> {profile.presence.activity}. {profile.presence.detail} Updated <Time value={profile.presence.updatedAt} />.</p>
          ) : <p><strong>Status:</strong> Off duty.</p>}
          {snapshot ? (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><dt className="font-semibold">Driver level</dt><dd>{snapshot.level}</dd></div>
              <div><dt className="font-semibold">Career rank</dt><dd>{snapshot.careerTitle}</dd></div>
              <div><dt className="font-semibold">Last saved location</dt><dd>{snapshot.lastSavedCity}</dd></div>
              <div><dt className="font-semibold">Backup accepted</dt><dd><Time value={snapshot.capturedAt} /></dd></div>
              <div><dt className="font-semibold">Total deliveries</dt><dd>{snapshot.deliveries.toLocaleString("en-US")}</dd></div>
              <div><dt className="font-semibold">Miles driven</dt><dd>{snapshot.milesDriven.toLocaleString("en-US")}</dd></div>
              <div><dt className="font-semibold">Reputation</dt><dd>{snapshot.reputation} out of 100</dd></div>
              {snapshot.onTimeDeliveries === undefined ? null : <div><dt className="font-semibold">On-time deliveries</dt><dd>{snapshot.onTimeDeliveries}</dd></div>}
              {snapshot.truckName ? <div><dt className="font-semibold">Current truck</dt><dd>{snapshot.truckName}</dd></div> : null}
              {snapshot.employmentStatus ? <div><dt className="font-semibold">Employment status</dt><dd>{snapshot.employmentStatus}</dd></div> : null}
            </dl>
          ) : <p>No server-verified career statistics are available yet.</p>}
        </section>
      ) : null}

      {section === "road-journal" ? (
        <section aria-labelledby="journal-heading" className="py-4">
          <FreightFateHashFocus />
          <h2 className="mb-2 text-2xl font-bold text-ink" id="journal-heading">Road journal</h2>
          <p>Newest entries first.</p>
          {profile.events.length ? (
            <ol className="mt-5 space-y-4">
              {profile.events.map((event: Event) => {
                const fragment = freightFateEventFragment(event.eventId);
                return (
                <li key={event._id}>
                  <article aria-labelledby={fragment} className="rounded border border-line-strong p-4">
                    <h3 className="scroll-mt-6 text-lg font-bold capitalize" id={fragment} tabIndex={-1}>{event.eventType.replaceAll("_", " ")}</h3>
                    <p>{event.summary}</p><p className="text-slate-700"><Time value={event.occurredAt} /></p>
                  </article>
                </li>);
              })}
            </ol>
          ) : <p>No road-journal entries are shared on this page.</p>}
          {cursor || profile.nextBefore ? (
          <nav aria-label="Road journal pagination" className="mt-6 flex flex-wrap gap-4">
            {cursor ? <Link href={`${root}/road-journal`}>Back to newest road-journal entries</Link> : null}
            {profile.nextBefore ? (
              <Link href={`${root}/road-journal?before=${encodeURIComponent(`${profile.nextBefore.occurredAt}:${profile.nextBefore.eventId}`)}`}>Older road-journal entries</Link>
            ) : null}
          </nav>
          ) : null}
        </section>
      ) : null}

      {section === "achievements" ? (
        <section aria-labelledby="achievements-heading" className="py-4">
          <h2 className="mb-4 text-2xl font-bold text-ink" id="achievements-heading">Achievements</h2>
          {profile.achievements.length ? (
            <ul className="space-y-4">
              {profile.achievements.map((item: Achievement) => (
                <li className="rounded border border-line-strong p-4" key={item._id}>
                  <h3 className="text-lg font-bold">{item.name}</h3><p>{item.description}</p>
                  <p>Unlocked. Earned <Time value={item.earnedAt} />.</p>
                </li>
              ))}
            </ul>
          ) : <p>No achievements are currently shared.</p>}
        </section>
      ) : null}

      <p><Link href="/freight-fate/updates">View all public Freight Fate updates</Link>.</p>
    </div>
  );
}
