import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FreightFateUpdates, parseUpdatesCursor } from "@/components/FreightFateUpdates";

export const metadata: Metadata = { title: "Freight Fate Updates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const cursor = parseUpdatesCursor((await searchParams).before);
  return (
    <div className="space-y-8">
      <PageHeader title="Freight Fate Updates" intro="Automatic fictional road-journal updates shared by drivers with public Profile sharing." />
      <FreightFateUpdates cursor={cursor} limit={20} />
    </div>
  );
}
