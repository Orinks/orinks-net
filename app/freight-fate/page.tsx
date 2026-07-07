import { FreightFateDriversBoard } from "@/components/FreightFateDriversBoard";
import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

// The embedded drivers board is live data with a three-minute heartbeat TTL;
// a cached page would make its "updated N minutes ago" phrases a lie.
export const dynamic = "force-dynamic";

export default function FreightFatePage() {
  return (
    <>
      <ProjectLanding project={getGame("/freight-fate")!} />
      <FreightFateDriversBoard />
    </>
  );
}
