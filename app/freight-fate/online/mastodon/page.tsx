import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { FreightFateOnlineProviders } from "../providers";
import { FreightFateMastodonClient } from "./mastodon-client";

export const metadata = {
  title: "Link Mastodon to Freight Fate",
};

export default function FreightFateMastodonPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Link Mastodon to Freight Fate"
        intro="Let Freight Fate post short public summaries of your notable deliveries to your own Mastodon account. You authorize your own server; nothing posts until you also turn sharing on in the game."
      />

      <FreightFateOnlineProviders>
        {/* useSearchParams (the OAuth result) requires a Suspense boundary
            during prerender. */}
        <Suspense fallback={<p>Loading…</p>}>
          <FreightFateMastodonClient />
        </Suspense>
      </FreightFateOnlineProviders>
    </div>
  );
}
