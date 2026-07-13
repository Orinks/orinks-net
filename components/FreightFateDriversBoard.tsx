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

function comparableSentence(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .toLocaleLowerCase("en-US");
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
