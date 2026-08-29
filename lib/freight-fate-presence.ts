/** The drivers board's shared vocabulary, importable from a browser.
 *
 * The board has two halves that must agree about when a driver stops
 * counting: the Convex query that the site's cached snapshot reads, and the
 * component that watches the live subscription and decides for itself. The
 * server half cannot be imported here -- convex/freightFate.ts pulls in the
 * Convex server runtime, and lib/freight-fate-online.ts pulls in node:crypto,
 * neither of which survives a trip to the browser -- so the two windows live
 * here and are paired by hand.
 *
 * KEEP THESE EQUAL TO PRESENCE_TTL_MS AND PRESENCE_IDLE_MS in
 * convex/freightFate.ts. Widening one side alone is the failure that matters:
 * a browser holding a longer window than the server shows drivers the server
 * has already dropped, which is exactly the "offering you a driver who signed
 * off" problem the live/snapshot split was built to avoid.
 */

/** A driver whose last heartbeat is older than this is off the board. */
export const PRESENCE_TTL_MS = 6 * 60_000;

/** Beating, but nothing has changed for this long: a truck parked with the
 * game left running, not a driver anyone can watch. */
export const PRESENCE_IDLE_MS = 30 * 60_000;

/** One driver as the site displays them.
 *
 * `updatedAt` is when we last heard from the game at all and is present only
 * on the server's snapshot; the live subscription deliberately has no access
 * to it. `changedAt` is when the status itself last moved, and is what every
 * "updated N minutes ago" phrase on the site measures.
 */
export type FreightFatePresenceDriver = {
  driverId: string;
  displayName: string;
  activity: string;
  detail: string;
  changedAt: number;
  updatedAt?: number;
};

export type FreightFatePresenceBoard = {
  drivers: FreightFatePresenceDriver[];
  /** The moment the snapshot was taken. Live results have no such stamp --
   * see the note on getLivePresenceBoard in convex/freightFate.ts. */
  asOf: number;
};

/** Last-ditch tidying of a name before it goes on screen.
 *
 * The backend has already screened and masked it; this only guards against a
 * name arriving in a shape the layout cannot take -- runs of whitespace, or
 * something long enough to swamp the row it sits in. Lives here rather than
 * in freight-fate-online.ts so the browser half of the list can use it too.
 */
export function normalizeFreightFateDisplayName(value: unknown, fallback = "Freight Fate Driver") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 48) || fallback;
}

/** Whether a driver still counts as on duty, judged at `asOf`.
 *
 * The server's snapshot has already applied this; the live subscription has
 * not, because a query that filtered on time would have to re-run to change
 * its answer, and nothing writes to the database when a truck merely sits
 * still. So the browser applies it against its own clock, for free.
 */
export function stillOnDuty(driver: FreightFatePresenceDriver, asOf: number) {
  return driver.changedAt >= asOf - PRESENCE_IDLE_MS;
}
