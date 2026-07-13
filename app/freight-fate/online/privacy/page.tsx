import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = { title: "Freight Fate Online Features" };

export default function FreightFatePrivacyPage() {
  return <div className="space-y-8">
    <PageHeader title="Freight Fate Online Features" />
    <Section title="Profile sharing">
      <p>Shows your driver name, profile, board status, road-journal posts, and achievements on orinks.net. Career statistics come from an accepted Cloud Backup. Turning it off removes them from public pages. Previously received data may remain stored and can reappear if you turn sharing on again.</p>
    </Section>
    <Section title="Cloud Backup">
      <p>Stores your full career for restore. It is separate from Profile sharing and is never published.</p>
      <p><Link href="/freight-fate/online/setup">Back to Freight Fate online setup</Link>.</p>
    </Section>
  </div>;
}
