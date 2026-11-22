import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { PAPER_ANNOUNCED } from "@/lib/freight-fate-paper-launch";
import { ProfileSharing } from "./profile-sharing";

export const metadata = { title: "Freight Fate Online Features" };

export default function FreightFatePrivacyPage() {
  return <div className="space-y-8">
    <PageHeader title="Freight Fate Online Features" />
    <Section title="Profile sharing">
      <ProfileSharing announced={PAPER_ANNOUNCED} />
    </Section>
    <Section title="Cloud Backup">
      <p>Cloud Backup remains private and is separate from Profile sharing. It automatically keeps up to ten careers for restore, removing the oldest inactive cloud career when space is needed.</p>
      <p>Cloud retention only changes the backups stored online. It never deletes a career stored on your computer, including when you restore an older cloud backup.</p>
    </Section>
    <Section title="Deleting your orinks.net account">
      <p>Your driver, cloud backups, road journal, and achievements are removed from the site. Careers stored on your computer are untouched.</p>
    </Section>
    <Section>
      <p><Link href="/freight-fate/online/setup">Back to Freight Fate online setup</Link>.</p>
    </Section>
  </div>;
}
