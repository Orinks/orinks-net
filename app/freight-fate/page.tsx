import { FreightFateDriversBoard } from "@/components/FreightFateDriversBoard";
import { FreightFateUpdates } from "@/components/FreightFateUpdates";
import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

// The embedded drivers board is a timestamped snapshot, not a live feed: its
// "as of" stamp and every "updated N minutes ago" phrase render from the same
// moment, so they stay true to each other in a cached page. Regenerate once a
// minute -- a fraction of the presence TTL, so the roster still means
// something -- instead of querying the backend on every page view.
export const revalidate = 60;

export default function FreightFatePage() {
  return (
    <>
      <ProjectLanding project={getGame("/freight-fate")!} />
      <FreightFateDriversBoard />
      <FreightFateUpdates compact limit={5} />
    </>
  );
}
