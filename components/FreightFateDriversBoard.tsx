import Link from "next/link";
import { Section } from "@/components/Section";
import {
  getFreightFatePresenceBoardSnapshot,
  normalizeFreightFateDisplayName,
} from "@/lib/freight-fate-online";

const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

function updatedPhrase(updatedAt: number, asOf: number) {
  const ageMinutes = Math.round((asOf - updatedAt) / 60_000);

  if (ageMinutes < 1) {
    return "Updated just now.";
  }

  return `Updated ${relativeTime.format(-ageMinutes, "minute")}.`;
}

function asOfPhrase(asOf: number) {
  const stamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(asOf));

  // The page does not refresh itself, and a screen reader lands on this
  // section with no page-load cue that the roster is a still frame. Say so,
  // and give the reader something to do about it.
  return `Board as of ${stamp} Eastern. Refresh the page to check again.`;
}

function sentence(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function comparableSentence(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .toLocaleLowerCase("en-US");
}

/** The "who's on duty" board, embedded on the Freight Fate page.
 *
 * Drivers opt in from the game (browser-confirmed identity, public
 * visibility chosen on the setup page); this component only ever renders
 * broad in-game activity.
 *
 * Three outcomes, deliberately kept apart:
 *
 * - Not configured (no Convex client): the section is omitted entirely. That
 *   is a property of the deployment, not of the request -- on a build without
 *   online presence the board genuinely does not exist, and saying so would be
 *   noise. The library logs it in production so a bad env var is not invisible.
 * - Unreachable: the heading stays and the paragraph explains. Most readers
 *   here navigate by heading, and a section that silently changes shape
 *   between loads sends them hunting for something that is not there -- worse
 *   now that a snapshot can hold the same state for a minute.
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
      <Section title="Drivers on duty">
        <p>
          We can&apos;t show who&apos;s on duty right now. This doesn&apos;t affect your game or
          your driver profile. Check back in a few minutes.
        </p>
      </Section>
    );
  }

  if (!board) {
    return null;
  }

  return (
    <Section title="Drivers on duty">
      <p>
        {`${
          board.drivers.length === 0
            ? "No drivers are on duty right now."
            : `${board.drivers.length} ${board.drivers.length === 1 ? "driver is" : "drivers are"} on duty.`
        } ${asOfPhrase(board.asOf)}`}
      </p>

      {board.drivers.length > 0 ? (
        <ul>
          {board.drivers.map((driver) => {
            const displayName = normalizeFreightFateDisplayName(
              driver.displayName,
              "Freight Fate Driver",
            );
            const activity = driver.activity.trim();
            const detail = driver.detail.trim();
            const status = [
              sentence(activity),
              comparableSentence(detail) === comparableSentence(activity) ? "" : sentence(detail),
              updatedPhrase(driver.updatedAt, board.asOf),
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={driver.driverId}>
                <Link href={`/freight-fate/drivers/${driver.driverId}`}>
                  {displayName}
                </Link>
                {`: ${status}`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
