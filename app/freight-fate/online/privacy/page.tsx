import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = { title: "Freight Fate Sharing and Privacy" };

export default function FreightFatePrivacyPage() {
  return <div className="space-y-8">
    <PageHeader title="Freight Fate Sharing and Privacy" intro="How public Profile sharing and private Cloud Backup work independently." />
    <Section title="What profile sharing publishes">
      <p>When Profile sharing is on, orinks.net may publish your driver identity, broad on-duty presence, automatic road-journal posts generated from eligible in-game events, official earned achievements, occurrence times, and allowlisted career details derived from your latest accepted private backup.</p>
      <p>If no accepted backup exists, the public profile remains available without detailed career statistics. The full backup is never public.</p>
      <p>Shared profiles can appear on the drivers board and updates feed. When Profile sharing is off, these records and counts remain private.</p>
    </Section>
    <Section title="Retention and revocation">
      <p>Turning sharing off immediately removes the profile and its updates from public discovery and stops future publication. Records already received may remain stored privately and can become visible again if sharing is renewed later.</p>
    </Section>
    <Section title="What is never included">
      <p>Public Profile sharing never includes the full save, money, coordinates, precise route position, active cargo details, or precise live location. The full save is received only when you separately enable private Cloud Backup.</p>
      <p><Link href="/freight-fate/online/setup">Return to Freight Fate online setup</Link>.</p>
    </Section>
    <Section title="Private Cloud Backup">
      <p>Cloud Backup is a separate setting. It can be enabled whether Profile sharing is on or off. When you turn it on, orinks.net receives the full career privately, validates it, and signs accepted revisions for safe restore.</p>
      <p>A rejected backup does not replace your accepted cloud revision and never changes the career stored on your computer. The full backup is never published. Turning either setting off does not change the other.</p>
    </Section>
  </div>;
}
