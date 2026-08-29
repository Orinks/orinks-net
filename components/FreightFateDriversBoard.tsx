import { FreightFateDriversBoardLive } from "@/components/FreightFateDriversBoardLive";
import { getFreightFatePresenceBoardSnapshot } from "@/lib/freight-fate-online";

/** The "who's on duty" list, embedded on the Freight Fate page.
 *
 * Drivers opt in from the game (browser-confirmed identity, public
 * visibility chosen on the setup page); this only ever shows broad in-game
 * activity.
 *
 * The server renders the cached snapshot and hands it to the client half,
 * which keeps it exactly as-is until the browser has hydrated and then
 * watches the backend for changes. So the still frame is what a crawler
 * sees, what someone without JavaScript keeps, and what stays on screen if
 * the subscription never answers -- and nobody gets an empty section while a
 * socket opens.
 *
 * Three outcomes, deliberately kept apart:
 *
 * - Not configured (no Convex client): the section is omitted entirely. That
 *   is a property of the deployment, not of the request -- on a build without
 *   online presence the list genuinely does not exist, and saying so would be
 *   noise. The library logs it in production so a bad env var is not invisible.
 * - Unreachable: the heading stays and the paragraph explains. Most readers
 *   here navigate by heading, and a section that silently changes shape
 *   between loads sends them hunting for something that is not there.
 * - Reachable with nobody driving: its own wording, never the failure wording.
 *   An empty road is real information.
 */
export async function FreightFateDriversBoard() {
  let board = null;

  try {
    board = await getFreightFatePresenceBoardSnapshot();
  } catch {
    // Reachability failure, not a missing deployment: keep the section and say
    // so. No live region -- this is server-rendered, present at first paint,
    // and never changes while the page is open.
    return (
      <BoardSection>
        <p>
          We can&apos;t show who&apos;s on duty right now. This doesn&apos;t affect your game or
          your driver profile. Check back in a few minutes.
        </p>
      </BoardSection>
    );
  }

  if (!board) {
    return null;
  }

  return (
    <BoardSection>
      <FreightFateDriversBoardLive initial={board} />
    </BoardSection>
  );
}

/** The section, named so it is reachable from the landmarks view.
 *
 * Rendered here rather than through the shared Section component, which is a
 * bare unnamed <section> and so is not exposed as a landmark at all. Every
 * comparable block on this site (the updates feed, the download list, the
 * home status panel) names its own section for the same reason, and this is
 * the one whose contents move on their own.
 */
function BoardSection({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="drivers-on-duty-heading" className="py-8">
      <h2 className="mb-4 text-2xl font-bold text-ink" id="drivers-on-duty-heading">
        Drivers on duty
      </h2>
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold prose-li:my-1">
        {children}
      </div>
    </section>
  );
}
