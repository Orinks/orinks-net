import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  getFreightFateSetupStatus,
  normalizeFreightFateDisplayName,
  normalizeFreightFateToken,
} from "@/lib/freight-fate-online";

export const metadata = {
  title: "Freight Fate Online Setup",
};

type SetupPageProps = {
  searchParams: Promise<{ token?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  expired: "This setup link has expired. Open online sharing from Freight Fate again to get a fresh link.",
  invalid: "This setup link is not valid. Open online sharing from Freight Fate again.",
  not_found: "This setup link was not found. Open online sharing from Freight Fate again.",
  "not-configured": "Freight Fate online sharing is not configured on this Orinks deployment.",
};

function SetupNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-line bg-white p-4 text-slate-800" role="status">
      {children}
    </p>
  );
}

export default async function FreightFateOnlineSetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const statusMessage = params.status ? statusMessages[params.status] : null;

  let setupStatus = null;

  try {
    setupStatus = token ? await getFreightFateSetupStatus(normalizeFreightFateToken(token, "Setup token")) : null;
  } catch {
    setupStatus = null;
  }

  const displayName =
    setupStatus?.configured && setupStatus.found
      ? normalizeFreightFateDisplayName(setupStatus.displayName, "Freight Fate Driver")
      : "Freight Fate Driver";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Freight Fate Online Setup"
        intro="Confirm whether this Freight Fate driver can share private road journal updates with Orinks."
      />

      <Section title="Confirm sharing">
        {statusMessage ? <SetupNotice>{statusMessage}</SetupNotice> : null}

        {!token ? (
          <SetupNotice>Open this page from Freight Fate so the setup link is filled in automatically.</SetupNotice>
        ) : !setupStatus?.configured ? (
          <SetupNotice>Freight Fate online sharing is not configured on this Orinks deployment.</SetupNotice>
        ) : !setupStatus.found ? (
          <SetupNotice>This setup link was not found. Open online sharing from Freight Fate again.</SetupNotice>
        ) : setupStatus.expired ? (
          <SetupNotice>This setup link has expired. Open online sharing from Freight Fate again.</SetupNotice>
        ) : setupStatus.confirmed ? (
          <SetupNotice>
            This driver is already set up.{" "}
            <Link href={`/freight-fate/drivers/${setupStatus.driverId}`}>Open the driver profile</Link>.
          </SetupNotice>
        ) : (
          <form className="max-w-xl space-y-5 rounded border border-line bg-white p-5" action="/api/freight-fate/setup/confirm" method="post">
            <input type="hidden" name="setupToken" value={token} />
            <p className="text-slate-800">
              Freight Fate opened this setup link for one driver identity. Confirming creates a private driver
              profile. You can switch it to unlisted if you want a shareable profile page.
            </p>

            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor="displayName">
                Driver name
              </label>
              <input
                className="w-full rounded border border-line px-3 py-2 text-ink"
                defaultValue={displayName}
                id="displayName"
                maxLength={48}
                name="displayName"
                required
                type="text"
              />
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor="visibility">
                Profile visibility
              </label>
              <select className="w-full rounded border border-line px-3 py-2 text-ink" id="visibility" name="visibility">
                <option value="private">Private: accept posts, do not show trip details publicly</option>
                <option value="unlisted">Unlisted: show trip details to anyone with the profile link</option>
              </select>
            </div>

            <button
              className="rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark"
              type="submit"
            >
              Confirm sharing
            </button>
          </form>
        )}
      </Section>

      <Section title="What Orinks receives">
        <ul>
          <li>A random driver ID created by Freight Fate.</li>
          <li>A protected posting token, stored only as a hash on Orinks.</li>
          <li>Short road journal events that Freight Fate chooses to publish after you opt in.</li>
        </ul>
        <p>Career save files, raw trip snapshots, and personal account details are not part of this setup.</p>
      </Section>
    </div>
  );
}
