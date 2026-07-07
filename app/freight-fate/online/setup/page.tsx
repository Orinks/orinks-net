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
          <li>Short road journal events that Freight Fate chooses to publish after you opt in.</li>
        </ul>
        <p>
          Career save files, raw trip snapshots, and personal account details are not part of this
          setup.
        </p>
      </Section>
    </div>
  );
}
