"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { useEffect } from "react";
import { FreightFatePaperEdition } from "@/components/FreightFatePaperEdition";
import {
  buildPaperView,
  type PaperChrome,
  type PaperEditionData,
} from "@/lib/freight-fate-paper-view";

// Nothing is said until the sign-in check and the read have both finished,
// so the owner never hears "No edition to preview" before the edition
// arrives. The edition then replaces the heading in one render; there is no
// live region (accessibility review, 2026-11-22).
export function PaperPreviewClient({ chrome, siteName }: { chrome: PaperChrome; siteName: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const edition = useQuery(
    anyApi.freightFatePaper.getEdition,
    isLoading || !isAuthenticated ? "skip" : {},
  ) as PaperEditionData | null | undefined;
  const heading = `${chrome.masthead} preview`;
  const title = edition ? `${heading}, issue ${edition.issue}` : heading;

  useEffect(() => {
    document.title = `${title} - ${siteName}`;
  }, [title, siteName]);

  if (edition) {
    return <FreightFatePaperEdition title={title} view={buildPaperView(edition, chrome, { latest: true })} />;
  }
  const finished = !isLoading && (!isAuthenticated || edition === null);
  return (
    <>
      <header className="border-b border-line pb-8">
        <h1 className="max-w-4xl text-4xl font-bold text-ink sm:text-5xl" tabIndex={-1}>{heading}</h1>
      </header>
      {finished ? <p className="py-8 text-lg">No edition to preview.</p> : null}
    </>
  );
}
