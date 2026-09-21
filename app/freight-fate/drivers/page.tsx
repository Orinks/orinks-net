import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FreightFateDriverDirectory } from "@/components/FreightFateDriverDirectory";

export const metadata: Metadata = { title: "Freight Fate Driver Directory" };

// The directory is built from a one-minute snapshot (see
// getFreightFateDriverDirectorySnapshot); this keeps the rendered page on the
// same clock so its "last on duty" ages and the list agree.
export const revalidate = 60;

export default function FreightFateDriversPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Driver directory"
        intro="Every Freight Fate driver with a public profile, whether they are on duty right now or not, and when each was last on duty. Open a driver to read their profile."
      />
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold prose-li:my-1">
        <FreightFateDriverDirectory />
      </div>
    </div>
  );
}
