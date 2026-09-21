import { FreightFateDriversBoard } from "@/components/FreightFateDriversBoard";
import { FreightFateUpdates } from "@/components/FreightFateUpdates";
import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

// This window governs the still frame the page is BUILT from -- what a
// crawler indexes, what a reader without JavaScript keeps, and what stays on
// screen until the browser has hydrated and taken over. Its stamp and every
// "updated N minutes ago" in it render from one moment, so they stay true to
// each other in a cached page.
//
// It is not what caps backend reads. Two things do that, and both survive
// this line being deleted: the cached snapshot behind
// getFreightFatePresenceBoardSnapshot, and the fact that the live
// subscription underneath takes no arguments, so every visitor watching the
// drivers list shares one cached execution rather than paying for their own.
// Do not reach for getFreightFateLivePresenceBoard to render anything here;
// that is the authoritative read, for deciding, not for showing.
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
