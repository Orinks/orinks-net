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
        intro="Sign in with your Orinks account to create a Freight Fate driver and get a posting token for the game."
      />

      <FreightFateOnlineProviders>
        <FreightFateSetupClient />
      </FreightFateOnlineProviders>

      <Section title="What Orinks receives">
        <ul>
          <li>A public driver ID and the driver name you choose.</li>
          <li>A posting token, stored only as a hash on Orinks.</li>
          <li>Broad on-duty activity for the live drivers board after renewed consent.</li>
          <li>Short factual road-journal events and official earned achievements.</li>
          <li>An allowlisted career snapshot: level, totals, current truck, last-saved city, and snapshot time.</li>
        </ul>
        <p>
          Orinks does not receive the full save, money, coordinates, active cargo details, or precise
          live location. Legacy board sharing does not activate expanded sharing; you must renew
          consent in the form above.
        </p>
      </Section>
    </div>
  );
}
