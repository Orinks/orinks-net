import { PageHeader } from "@/components/PageHeader";
import { FreightFateOnlineProviders } from "../online/providers";
import { StationSuggestionClient } from "./station-suggestion-client";

export const metadata = {
  title: "Suggest a Radio Station for Freight Fate",
};

export default function SuggestAStationPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <>
      <PageHeader
        title="Suggest a Radio Station"
        intro="Send a station to the Freight Fate team for review."
      />
      {/* Not wrapped in <Section>: its prose styles would fight the form's own
          spacing, the same call the contact page makes. */}
      <section className="py-8">
        <FreightFateOnlineProviders>
          <StationSuggestionClient siteKey={siteKey} />
        </FreightFateOnlineProviders>
      </section>
    </>
  );
}
