import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { getFreightFatePresenceBoard } from "@/lib/freight-fate-online";

export const metadata = {
  title: "Freight Fate Drivers on Duty",
};

// The board is live data with a three-minute heartbeat TTL; a cached page
// would make every "updated N minutes ago" phrase a lie.
export const dynamic = "force-dynamic";

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

export default async function FreightFateDriversOnlinePage() {
  const board = await getFreightFatePresenceBoard();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Freight Fate Drivers on Duty"
        intro="The live drivers board: everyone hauling freight in Freight Fate right now who chose to share it. Drivers opt in from the game and pick their own driver name; the board shows in-game activity only."
      />

      <Section title="On duty now">
        {!board ? (
          <p>The drivers board is not available right now. Try again in a moment.</p>
        ) : (
          <>
            <p>
              {board.drivers.length === 0
                ? "No drivers are on duty right now."
                : `${board.drivers.length} ${board.drivers.length === 1 ? "driver is" : "drivers are"} on duty.`}{" "}
              {asOfPhrase(board.asOf)}
            </p>

            {board.drivers.length > 0 ? (
              <ul>
                {board.drivers.map((driver) => (
                  <li key={driver.driverId}>
                    <Link href={`/freight-fate/drivers/${driver.driverId}`}>{driver.displayName}</Link>.{" "}
                    {sentence(driver.activity)} {sentence(driver.detail)}{" "}
                    {updatedPhrase(driver.updatedAt, board.asOf)}
                  </li>
                ))}
              </ul>
            ) : null}

            <p>
              <Link href="/freight-fate/online">Refresh the drivers board</Link>
            </p>
          </>
        )}
      </Section>

      <Section title="About this board">
        <p>
          Appearing here is strictly opt-in. Drivers enable sharing inside Freight Fate, confirm a driver
          name in their browser, and choose the public listing. The board only ever shows broad in-game
          activity, like the route and cargo of a fictional haul; it never shows anything about the real
          player. Drivers drop off the board within a few minutes of going off duty or turning sharing off.
        </p>
      </Section>
    </div>
  );
}
