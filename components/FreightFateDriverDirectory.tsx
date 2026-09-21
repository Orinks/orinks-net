import Link from "next/link";
import { getFreightFateDriverDirectorySnapshot } from "@/lib/freight-fate-online";
import {
  lastOnDutyPhrase,
  normalizeFreightFateDisplayName,
  type FreightFateDirectoryDriver,
} from "@/lib/freight-fate-presence";

/** Every driver with a public profile, on duty or not.
 *
 * The drivers list on the Freight Fate page answers "who is out right now";
 * this answers "who is there at all, and when did I last miss them". Drivers
 * on duty come first, then everyone else by how recently they went off duty,
 * the order the backend sends. No live half: a directory does not reshuffle
 * under a reader, and the "last on duty" ages are all measured from the one
 * moment the snapshot was taken, so a cached page stays true to itself.
 *
 * Same three outcomes as the board, kept apart the same way: not configured
 * is a property of the deployment and says nothing; unreachable keeps the
 * heading and explains; reachable with nobody listed has its own wording.
 */
export async function FreightFateDriverDirectory() {
  let directory = null;

  try {
    directory = await getFreightFateDriverDirectorySnapshot();
  } catch {
    return (
      <p>
        We can&apos;t show the driver directory right now. This doesn&apos;t affect your game or your
        driver profile. Check back in a few minutes.
      </p>
    );
  }

  if (!directory) {
    return <p>The driver directory is not available on this site.</p>;
  }

  const rows = directory.drivers.map((driver) => ({
    ...driver,
    displayName: normalizeFreightFateDisplayName(driver.displayName),
  }));

  if (rows.length === 0) {
    return <p>No drivers have a public profile yet.</p>;
  }

  const onDuty = rows.filter((driver) => driver.onDuty).length;
  const shared = spokenTwice(rows);

  return (
    <>
      <p>{countPhrase(rows.length, onDuty)}</p>
      <ul aria-label="Driver directory">
        {rows.map((driver) => (
          <li key={driver.driverId}>
            <Link
              href={`/freight-fate/drivers/${driver.driverId}`}
              // Heard out of context in a list of links, a bare name gives no
              // clue it leads anywhere; the visible text stays a leading
              // substring so saying what is on screen still works. Two rows
              // that sound the same carry the tail of the driver's own id.
              aria-label={
                (shared.get(driver.displayName.toLocaleLowerCase("en-US")) ?? 0) > 1
                  ? `${driver.displayName}, driver profile ${driver.driverId.slice(-4)}`
                  : `${driver.displayName}, driver profile`
              }
            >
              {driver.displayName}
            </Link>
            {`: ${statusLine(driver, directory.asOf)}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function countPhrase(total: number, onDuty: number) {
  const profiles = `${total} ${total === 1 ? "driver has" : "drivers have"} a public profile.`;
  if (onDuty === 0) {
    return `${profiles} None are on duty right now.`;
  }
  return `${profiles} ${onDuty} ${onDuty === 1 ? "is" : "are"} on duty right now.`;
}

/** What a row says after the name: on duty and doing what, or when they
 * were last on duty. */
export function statusLine(driver: FreightFateDirectoryDriver, asOf: number) {
  if (driver.onDuty) {
    const activity = sentence(driver.activity ?? "");
    return activity ? `On duty. ${activity}` : "On duty.";
  }
  return lastOnDutyPhrase(driver.lastOnDutyAt, asOf);
}

function sentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Names two rows would say identically (see the drivers list for why only
 * a moderated, masked name can collide). */
function spokenTwice(rows: FreightFateDirectoryDriver[]) {
  const seen = new Map<string, number>();
  for (const driver of rows) {
    const key = driver.displayName.toLocaleLowerCase("en-US");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return seen;
}
