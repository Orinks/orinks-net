import { PageHeader } from "@/components/PageHeader";
import { FreightFateOnlineProviders } from "../online/providers";
import { StationReviewClient } from "./station-review-client";

// The page the daily station digest links to. The link's token is the only
// credential, so the page is kept out of search and never sends it on.
export const metadata = {
  title: "Review Station Suggestions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ReviewStationsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <>
      <PageHeader title="Review Station Suggestions" />
      <section className="py-8">
        <FreightFateOnlineProviders>
          <StationReviewClient token={t ?? ""} />
        </FreightFateOnlineProviders>
      </section>
    </>
  );
}
