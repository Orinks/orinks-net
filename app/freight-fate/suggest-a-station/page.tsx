import { PageHeader } from "@/components/PageHeader";
import { FreightFateOnlineProviders } from "../online/providers";
import { StationSuggestionClient } from "./station-suggestion-client";

export const metadata = {
  title: "Suggest a Radio Station for Freight Fate",
};

export default function SuggestAStationPage() {
  return (
    <>
      <PageHeader
        title="Suggest a Radio Station"
        intro="Accepted stations reach every player without a game update."
      />
      {/* Not wrapped in <Section>: its prose styles would fight the form's own
          spacing, the same call the contact page makes. */}
      <section className="py-8">
        <FreightFateOnlineProviders>
          <StationSuggestionClient />
        </FreightFateOnlineProviders>
      </section>
    </>
  );
}
