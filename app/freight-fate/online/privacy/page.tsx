import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = { title: "Freight Fate Sharing and Privacy" };

export default function FreightFatePrivacyPage() {
  return <div className="space-y-8">
    <PageHeader title="Freight Fate Sharing and Privacy" intro="What the optional Profile sharing setting publishes, retains, and excludes." />
    <Section title="What profile sharing publishes">
      <p>When Profile sharing is on, Orinks may publish your driver identity, broad on-duty presence, automatic fictional road-journal posts generated from eligible in-game events, official earned achievements, occurrence times, and an allowlisted career snapshot including profile statistics and your last-saved city.</p>
      <p>Shared profiles can appear on the drivers board and updates feed. When Profile sharing is off, these records and counts remain private.</p>
    </Section>
    <Section title="Retention and revocation">
      <p>Turning sharing off immediately removes the profile and its updates from public discovery and stops future publication. Records already received may remain stored privately and can become visible again if sharing is renewed later.</p>
    </Section>
    <Section title="What is never included">
      <p>Freight Fate does not send the full save, money, coordinates, precise route position, active cargo details, or precise live location as part of this sharing feature.</p>
      <p><Link href="/freight-fate/online/setup">Return to Freight Fate online setup</Link>.</p>
    </Section>
  </div>;
}
