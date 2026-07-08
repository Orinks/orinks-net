import Link from "next/link";
import { Section } from "@/components/Section";
import {
  getFreightFatePresenceBoard,
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

  return `Board as of ${stamp} Eastern.`;
}

function sentence(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The live "who's on duty" board, embedded on the Freight Fate page.
 *
 * Drivers opt in from the game (browser-confirmed identity, public
 * visibility chosen on the setup page); this component only ever renders
 * broad in-game activity. When the board is unreachable or not configured
 * the section quietly disappears rather than showing an error on the
 * project landing page.
 */
export async function FreightFateDriversBoard() {
  let board = null;

  try {
    board = await getFreightFatePresenceBoard();
  } catch {
    board = null;
  }

  if (!board) {
    return null;
  }

  return (
    <Section title="Drivers on duty">
      <p>
        {board.drivers.length === 0
          ? "No drivers are on duty right now."
          : `${board.drivers.length} ${board.drivers.length === 1 ? "driver is" : "drivers are"} on duty.`}{" "}
        {asOfPhrase(board.asOf)}
      </p>

      {board.drivers.length > 0 ? (
        <ul>
          {board.drivers.map((driver) => {
            const displayName = normalizeFreightFateDisplayName(
              driver.displayName,
              "Freight Fate Driver",
            );
            // Driver names are user-supplied and can collide; the activity cue
            // keeps each link's accessible name distinct in a links list.
            const activity = driver.activity.trim();
            const ariaLabel = activity
              ? `${displayName} — ${activity}`
              : `${displayName} — driver profile`;
            return (
              <li key={driver.driverId}>
                <Link aria-label={ariaLabel} href={`/freight-fate/drivers/${driver.driverId}`}>
                  {displayName}
                </Link>
                . {sentence(driver.activity)} {sentence(driver.detail)}{" "}
                {updatedPhrase(driver.updatedAt, board.asOf)}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p>
        Players appear here while hauling a load, and only if they turned on sharing inside Freight Fate
        and chose the public listing. The board shows in-game activity only, never anything about the real
        player. <Link href="/freight-fate">Open the Freight Fate page</Link> for the latest board.
      </p>
    </Section>
  );
}
