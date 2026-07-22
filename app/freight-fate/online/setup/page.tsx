import Link from "next/link";
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

      <Section title="Mastodon sharing">
        <p>
          Optional: Freight Fate can post short public summaries of your notable deliveries to
          your own Mastodon account with the FreightFate hashtag. Only runs that earn an achievement, a
          driver level, or a perfect streak milestone are posted, and nothing posts until you also
          turn the setting on in the game.{" "}
          <Link href="/freight-fate/online/mastodon">Link Mastodon to Freight Fate</Link>.
        </p>
      </Section>
    </div>
  );
}
