import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { getFreightFateDriverProfile, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export const metadata = {
  title: "Freight Fate Driver",
};

type DriverPageProps = {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<{ setup?: string }>;
};

type DriverEvent = {
  _id: string;
  eventType: string;
  summary: string;
  occurredAt: number;
};

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function FreightFateDriverPage({ params, searchParams }: DriverPageProps) {
  const { driverId: rawDriverId } = await params;
  const query = await searchParams;
  const driverId = normalizeFreightFateDriverId(rawDriverId);
  const profile = await getFreightFateDriverProfile(driverId);

  if (!profile) {
    notFound();
  }

  const confirmed = query.setup === "confirmed";

  return (
    <div className="space-y-8">
      <PageHeader
        title={profile.driver.visibility === "private" ? "Private Freight Fate Driver" : profile.driver.displayName}
        intro="A Freight Fate online driver profile connected through Orinks."
      />

      {confirmed ? (
        <p className="rounded border border-line bg-soft-green p-4 text-slate-800" role="status">
          Sharing is confirmed. Freight Fate can now publish road journal events for this driver.
        </p>
      ) : null}

      <Section title="Driver profile">
        <dl className="grid gap-3 sm:grid-cols-2">
          {/* Private profiles mask the name in the title; keep the dl
              consistent with that rather than leaking it here. */}
          {profile.driver.visibility !== "private" ? (
            <div>
              <dt className="font-semibold text-ink">Driver name</dt>
              <dd>{profile.driver.displayName}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-ink">Visibility</dt>
            <dd>{profile.driver.visibility}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Created</dt>
            <dd>{formatDate(profile.driver.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Last update</dt>
            <dd>{formatDate(profile.driver.updatedAt)}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Road journal">
        {profile.driver.visibility === "private" ? (
          <p>This profile is private. Freight Fate can post to it, but Orinks does not show trip details publicly.</p>
        ) : profile.events.length > 0 ? (
          <ol>
            {profile.events.map((event: DriverEvent) => (
              <li key={event._id}>
                <strong>{event.eventType}:</strong> {event.summary}{" "}
                <span className="text-slate-700">({formatDate(event.occurredAt)})</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>No road journal entries have been posted yet.</p>
        )}
      </Section>
    </div>
  );
}
