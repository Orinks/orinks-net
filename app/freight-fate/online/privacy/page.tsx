import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = { title: "Freight Fate Online Features" };

export default function FreightFatePrivacyPage() {
  return <div className="space-y-8">
    <PageHeader title="Freight Fate Online Features" />
    <Section title="Profile sharing">
      <p>Publishes your driver name, current verified career and resume, account-wide achievements, board status, and road-journal posts on orinks.net. Turning Profile sharing off removes them from public pages. Previously received data may remain stored and can reappear if you turn sharing on again.</p>
      <p>Meaningful play selects your current career. Accepting a job, starting a drive, completing a delivery, or changing equipment or business status marks that career as current. Browsing, opening, or loading a career does not switch it.</p>
      <p>Current cash, available credit, precise location, active cargo details, fatigue, hours-of-service state, and dispatcher standing remain private.</p>
    </Section>
    <Section title="Cloud Backup">
      <p>Cloud Backup remains private and is separate from Profile sharing. It automatically keeps up to ten careers for restore, removing the oldest inactive cloud career when space is needed.</p>
      <p>Cloud retention only changes the backups stored online. It never deletes a career stored on your computer, including when you restore an older cloud backup.</p>
      <p><Link href="/freight-fate/online/setup">Back to Freight Fate online setup</Link>.</p>
    </Section>
  </div>;
}
