import { FreightFateDriversBoard } from "@/components/FreightFateDriversBoard";
import { FreightFateUpdates } from "@/components/FreightFateUpdates";
import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

// The embedded drivers board is a timestamped snapshot, not a live feed: its
// "as of" stamp and every "updated N minutes ago" phrase render from the same
// moment, so they stay true to each other in a cached page.
//
// This page-level window is only a second layer. What actually caps backend
// reads is the cached snapshot behind getFreightFatePresenceBoardSnapshot, so
// when something on this page has to be live -- a CB channel, a convoy roster
// -- delete this line and let the page render per request. The board keeps its
// own cache and the backend cost does not move. Do not reach for
// getFreightFateLivePresenceBoard to render anything here; that is the
// authoritative read, for deciding, not for showing.
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
