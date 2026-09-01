import { cache, type ReactNode } from "react";
import Link from "next/link";
import { FreightFateHashFocus } from "@/components/FreightFateHashFocus";
import { freightFateEventFragment } from "@/lib/freight-fate-fragments";
import { PageHeader } from "@/components/PageHeader";
import { getFreightFateDriverProfile, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export type ProfileSection = "overview" | "road-journal" | "achievements";
export type JournalCursor = { occurredAt: number; eventId: string };
export type AchievementCursor = { sortAt: number; achievementKey: string };
type Event = { _id: string; eventId: string; eventType: string; summary: string; occurredAt: number };
type Achievement = { _id: string; achievementKey: string; label: string; earnedAt: number };
type AccountAchievement = Omit<Achievement, "earnedAt"> & { earnedAt?: number };
const inlineLinkClass = "font-semibold text-action underline";

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
          <li className="min-w-0" key={key}>
            <Link
              aria-current={section === key ? "page" : undefined}
              className="inline-block min-h-11 max-w-full rounded border border-transparent px-3 py-2 font-semibold text-action underline [overflow-wrap:anywhere] aria-[current=page]:border-line-strong aria-[current=page]:bg-slate-100 aria-[current=page]:text-ink"
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

function FactList({ facts }: { facts: Array<[label: string, value: ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="font-semibold">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function dollars(value: number) {
  return `${value.toLocaleString("en-US")} dollars`;
}

function wholeNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function percent(value: number) {
  return `${wholeNumber(value)}%`;
}

function SafetyRecord({ record }: { record: {
  citations: number; seriousViolations: number; majorOffenses: number;
  cargoClaims?: number; preventableEquipmentDamage?: number;
  carrierTerminations: number; repossessions: number;
} }) {
  const counted = (count: number, singular: string, plural = `${singular}s`) =>
    `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
  const parts = [
    counted(record.citations, "citation"),
    counted(record.seriousViolations, "serious violation"),
    counted(record.majorOffenses, "major offense"),
    ...(record.cargoClaims === undefined ? [] : [counted(record.cargoClaims, "cargo claim")]),
    ...(record.preventableEquipmentDamage === undefined ? [] : [counted(record.preventableEquipmentDamage, "preventable equipment damage incident")]),
    counted(record.carrierTerminations, "carrier termination"),
    counted(record.repossessions, "repossession"),
  ];
  return <ul className="space-y-1">{parts.map((part) => <li key={part}>{part}</li>)}</ul>;
}

function achievementCountText(count: number) {
  return `${count.toLocaleString("en-US")} achievement${count === 1 ? "" : "s"}.`;
}

// Every one of these pages reads the profile twice: once for the page title
// and once for the body. Memoizing per request makes that a single database
// read, and the title can no longer describe a different snapshot than the
// page under it. A paginated road journal still reads twice — its title is
// built without the cursor, so the two calls are genuinely different reads.
export const safeProfile = cache(async (
  driverId: string,
  cursor?: JournalCursor,
  achievementCursor?: AchievementCursor,
) => {
  try {
    return await getFreightFateDriverProfile(
      normalizeFreightFateDriverId(driverId), 20, cursor, achievementCursor,
    );
  } catch {
    return null;
  }
});

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

export function parseAchievementCursor(value: string | undefined): AchievementCursor | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  if (separator < 1) return undefined;
  const sortAt = Number(value.slice(0, separator));
  const achievementKey = value.slice(separator + 1);
  return Number.isSafeInteger(sortAt) && sortAt >= -1
    && achievementKey.length > 0 && achievementKey.length <= 96
    ? { sortAt, achievementKey }
    : undefined;
}

function Unavailable() {
  return <PageHeader title="Freight Fate Profile Unavailable" />;
}

export async function DriverProfileView({ driverId: raw, section, cursor, achievementCursor, confirmed = false }: {
  driverId: string; section: ProfileSection; cursor?: JournalCursor;
  achievementCursor?: AchievementCursor; confirmed?: boolean;
}) {
  const profile = await safeProfile(raw, cursor, achievementCursor);
  if (!profile) return <Unavailable />;
  const { driver, snapshot } = profile;
  const root = `/freight-fate/drivers/${driver.driverId}`;
  return (
    <div className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
      <PageHeader title={driver.displayName} />
      {confirmed ? <p className="rounded border border-line-strong bg-soft-green p-4">Profile sharing is on.</p> : null}
      <ProfileNav driverId={driver.driverId} section={section} />

      {section === "overview" ? (
        <>
          <section className="min-w-0 py-4">
            <h2 className="mb-4 text-2xl font-bold text-ink" id="career-heading">Current career</h2>
            {snapshot ? <FactList facts={[
              ...(snapshot.saveName ? [["Career name", snapshot.saveName] as [string, ReactNode]] : []),
              ...(snapshot.businessIdentity ? [["Employment", snapshot.businessIdentity] as [string, ReactNode]] : snapshot.employmentStatus ? [["Employment", snapshot.employmentStatus] as [string, ReactNode]] : []),
              ...(snapshot.carrierName ? [["Carrier", snapshot.carrierName] as [string, ReactNode]] : []),
              ["Driver level", snapshot.level.toLocaleString("en-US")],
              ["Career title", snapshot.careerTitle],
              ...(snapshot.truckName ? [["Tractor", `${snapshot.truckName}${snapshot.truckIsCarrierAssigned === true ? " (carrier-assigned)" : snapshot.truckIsCarrierAssigned === false ? " (owned)" : ""}`] as [string, ReactNode]] : []),
              ...(snapshot.fleetTier ? [["Carrier fleet tier", snapshot.fleetTier] as [string, ReactNode]] : []),
            ]} /> : <p>No current career has been shared yet.</p>}
            {profile.presence ? <p className="mt-4"><strong>Status:</strong> On duty. Updated <Time value={profile.presence.updatedAt} />.</p> : <p className="mt-4"><strong>Status:</strong> Off duty.</p>}
          </section>

          <section className="min-w-0 py-4">
            <h2 className="mb-4 text-2xl font-bold text-ink" id="resume-heading">Current career resume</h2>
            {snapshot ? <FactList facts={[
              ["Lifetime deliveries", snapshot.deliveries.toLocaleString("en-US")],
              ["Lifetime miles", wholeNumber(snapshot.milesDriven)],
              ...(snapshot.onTimeRate === undefined ? [] : [["On-time percentage", percent(snapshot.onTimeRate)] as [string, ReactNode]]),
              ...(snapshot.damageFreeRate === undefined ? [] : [["Damage-free percentage", percent(snapshot.damageFreeRate)] as [string, ReactNode]]),
              ...(snapshot.safetyRecord ? [["Safety record", <SafetyRecord key="safety-record" record={snapshot.safetyRecord} />] as [string, ReactNode]] : []),
              ...(snapshot.statesVisited === undefined ? [] : [["States visited", snapshot.statesVisited.toLocaleString("en-US")] as [string, ReactNode]]),
              ...(snapshot.citiesVisited === undefined ? [] : [["Cities visited", snapshot.citiesVisited.toLocaleString("en-US")] as [string, ReactNode]]),
              ...(snapshot.longestHaulMiles === undefined ? [] : [["Longest haul", `${wholeNumber(snapshot.longestHaulMiles)} miles`] as [string, ReactNode]]),
              ...(snapshot.lifetimeEarnings === undefined ? [] : [["Lifetime career earnings", dollars(snapshot.lifetimeEarnings)] as [string, ReactNode]]),
              ...(snapshot.netWorth === undefined || snapshot.netWorthComplete !== true ? [] : [["Net worth", dollars(snapshot.netWorth)] as [string, ReactNode]]),
              ["Reputation", `${wholeNumber(snapshot.reputation)} out of 100`],
              ...(snapshot.endorsements === undefined ? [] : [["Endorsements", snapshot.endorsements.length ? snapshot.endorsements.join(", ") : "None yet"] as [string, ReactNode]]),
            ]} /> : <p>No current career resume has been shared yet.</p>}
          </section>

          <section className="min-w-0 py-4">
            <h2 className="mb-4 text-2xl font-bold text-ink" id="account-achievements-heading">Achievements</h2>
            {profile.achievementCount ? <>
              <p>{achievementCountText(profile.achievementCount)}</p>
              <ul className="mt-4 space-y-3">
                {profile.recentAchievements.map((item: Achievement) => (
                  <li className="min-w-0 [overflow-wrap:anywhere]" key={item._id}>
                    <h3 className="font-bold">{item.label}</h3>
                    <p>Earned <Time value={item.earnedAt} />.</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4"><Link className={inlineLinkClass} href={`${root}/achievements`}>View all achievements</Link>.</p>
            </> : <p>No achievements yet.</p>}
          </section>

          <section className="min-w-0 py-4">
            <h2 className="mb-4 text-2xl font-bold text-ink" id="recent-journal-heading">Road journal</h2>
            {profile.events.length ? <>
              <ul className="space-y-4">
                {profile.events.slice(0, 3).map((event: Event) => (
                  <li className="min-w-0 [overflow-wrap:anywhere]" key={event._id}>
                    <h3 className="font-bold capitalize">{event.eventType.replaceAll("_", " ")}</h3>
                    <p>{event.summary}</p>
                    <p className="text-slate-700"><Time value={event.occurredAt} /></p>
                  </li>
                ))}
              </ul>
              <p className="mt-4"><Link className={inlineLinkClass} href={`${root}/road-journal`}>View the full road journal</Link>.</p>
            </> : <p>No road-journal entries yet.</p>}
          </section>
        </>
      ) : null}

      {section === "road-journal" ? (
        <section className="py-4">
          <FreightFateHashFocus />
          <h2 className="mb-2 text-2xl font-bold text-ink" id="journal-heading">Road journal</h2>
          <p>Newest entries first.</p>
          {profile.events.length ? (
            <ul className="mt-5 space-y-4">
              {profile.events.map((event: Event) => {
                const fragment = freightFateEventFragment(event.eventId);
                return (
                <li key={event._id}>
                  <article aria-labelledby={fragment} className="min-w-0 rounded border border-line-strong p-4 [overflow-wrap:anywhere]">
                    <h3 className="scroll-mt-6 text-lg font-bold capitalize" id={fragment} tabIndex={-1}>{event.eventType.replaceAll("_", " ")}</h3>
                    <p>{event.summary}</p><p className="text-slate-700"><Time value={event.occurredAt} /></p>
                  </article>
                </li>);
              })}
            </ul>
          ) : <p>No road-journal entries yet.</p>}
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
        <section className="py-4">
          <h2 className="mb-4 text-2xl font-bold text-ink" id="achievements-heading">Achievements</h2>
          <p className="mb-4">{achievementCountText(profile.achievementCount)}</p>
          {profile.achievements.length ? (
            <ul className="space-y-4">
              {profile.achievements.map((item: AccountAchievement) => (
                <li className="min-w-0 rounded border border-line-strong p-4 [overflow-wrap:anywhere]" key={item._id}>
                  <h3 className="text-lg font-bold">{item.label}</h3>
                  <p>{item.earnedAt === undefined ? "Unlocked." : <>Unlocked. Earned <Time value={item.earnedAt} />.</>}</p>
                </li>
              ))}
            </ul>
          ) : <p>No achievements yet.</p>}
          {achievementCursor || profile.nextAchievementBefore ? (
            <nav aria-label="Achievements pagination" className="mt-6 flex flex-wrap gap-4">
              {achievementCursor ? <Link className={inlineLinkClass} href={`${root}/achievements`}>Back to newest achievements</Link> : null}
              {profile.nextAchievementBefore ? (
                <Link className={inlineLinkClass} href={`${root}/achievements?before=${encodeURIComponent(`${profile.nextAchievementBefore.sortAt}:${profile.nextAchievementBefore.achievementKey}`)}`}>Older achievements</Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      ) : null}

      <p><Link href="/freight-fate/updates">View all Freight Fate updates</Link>.</p>
    </div>
  );
}
