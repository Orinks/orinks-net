import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { FreightFateOnlineProviders } from "../providers";
import { FreightFateSetupClient } from "./setup-client";

export const metadata = {
  title: "Freight Fate Online Setup",
};

export default function FreightFateOnlineSetupPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Freight Fate Online Setup"
        intro="Sign in with your orinks.net account to create a Freight Fate driver and get a posting token for the game."
      />

      <FreightFateOnlineProviders>
        <FreightFateSetupClient />
      </FreightFateOnlineProviders>

      <Section title="What orinks.net receives">
        <ul>
          <li>A driver ID and the driver name you choose when connecting the game.</li>
          <li>A posting token, stored only as a hash on orinks.net.</li>
          <li>When Profile sharing is on: broad on-duty activity for the live drivers board.</li>
          <li>When Profile sharing is on: automatic road-journal posts and official earned achievements.</li>
          <li>When Profile sharing is on: career details derived only from the latest accepted private Cloud Backup revision.</li>
          <li>When Cloud Backup is separately enabled: the full career, stored privately for validation and restore.</li>
        </ul>
        <p>
          Profile sharing never publishes the full save, money, coordinates, active cargo details, or
          precise live location. Cloud Backup is a separate private choice and never creates a public download.
        </p>
      </Section>
    </div>
  );
}
