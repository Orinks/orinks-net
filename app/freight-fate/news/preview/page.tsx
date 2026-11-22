import { FreightFateOnlineProviders } from "../../online/providers";
import { PAPER_CHROME, PAPER_NAME, getPaperGameNews } from "@/lib/freight-fate-paper-page";
import { site } from "@/lib/site";
import { PaperPreviewClient } from "./preview-client";

// The owner's look at an edition the public cannot read yet. Pages here are
// rendered without knowing who is signed in, so the edition is read in the
// browser with the owner's sign-in; the backend returns nothing to anyone
// else.
export const metadata = {
  title: `${PAPER_NAME} preview`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FreightFateNewsPreviewPage() {
  const gameNews = await getPaperGameNews();
  return (
    <FreightFateOnlineProviders>
      <PaperPreviewClient chrome={PAPER_CHROME} gameNews={gameNews} siteName={site.name} />
    </FreightFateOnlineProviders>
  );
}
