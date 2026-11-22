import type { Metadata } from "next";
import { FreightFateOnlineProviders } from "../../online/providers";
import { notFound } from "next/navigation";
import { PAPER_CHROME, readPaperListings } from "@/lib/freight-fate-paper-page";
import { site } from "@/lib/site";
import { PaperPreviewClient } from "./preview-client";

// The owner's look at an edition the public cannot read yet. Pages here are
// rendered without knowing who is signed in, so the edition is read in the
// browser with the owner's sign-in; the backend returns nothing to anyone
// else. While the paper is off the route is a plain 404, and until an
// edition is drawn the page names no paper.
export async function generateMetadata(): Promise<Metadata> {
  const listings = await readPaperListings();
  if (!listings.ok || listings.value === null) return {};
  return { title: "Edition preview", robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

export default async function FreightFateNewsPreviewPage() {
  // The cached list answers null only while FREIGHT_FATE_PAPER is off.
  const listings = await readPaperListings();
  if (!listings.ok || listings.value === null) notFound();
  return (
    <FreightFateOnlineProviders>
      <PaperPreviewClient chrome={PAPER_CHROME} siteName={site.name} />
    </FreightFateOnlineProviders>
  );
}
