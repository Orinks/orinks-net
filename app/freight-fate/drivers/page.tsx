import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FreightFateDriverDirectory } from "@/components/FreightFateDriverDirectory";

export const metadata: Metadata = { title: "Freight Fate Driver Directory" };

// Rendered per request. The data under it is still a one-minute snapshot
// (getFreightFateDriverDirectorySnapshot, with its freshness guard), so this
// costs no extra backend reads. What it removes is the second cache on top:
// as an ISR page the whole HTML was served stale-while-revalidating, so the
// first reader after a quiet spell got a page rendered up to hours earlier
// and heard "None are on duty" with drivers out, or the reverse (live site,
// 2026-09-21: Age 3056 s, x-vercel-cache STALE).
export const dynamic = "force-dynamic";

export default function FreightFateDriversPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Driver directory"
        intro="Every Freight Fate driver with a public profile, whether they are on duty right now or not, and when each was last on duty."
      />
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold prose-li:my-1">
        <FreightFateDriverDirectory />
      </div>
    </div>
  );
}
