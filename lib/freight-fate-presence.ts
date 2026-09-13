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

/** One driver as the directory lists them: everyone with a public profile,
 * on duty or not.
 *
 * `onDuty` is judged by the server against the same windows as the board.
 * `activity`, `detail` and `changedAt` are present only while on duty;
 * `lastOnDutyAt` is the last moment the server saw the driver on duty, and is
 * absent for a driver no session has ended for since the stamp existed.
 */
export type FreightFateDirectoryDriver = {
  driverId: string;
  displayName: string;
  onDuty: boolean;
  activity?: string;
  detail?: string;
  changedAt?: number;
  lastOnDutyAt?: number;
};

export type FreightFateDriverDirectory = {
  drivers: FreightFateDirectoryDriver[];
  /** The moment the snapshot was taken; every age in it is measured from
   * this, so a cached page stays true to itself. */
  asOf: number;
};

const coarseRelative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "Last on duty three days ago", deliberately coarse.
 *
 * The directory says when a driver was last around, not when their game
 * closed to the minute: a minute-precise stamp on an offline player is a
 * detail nobody needs and one they did not sign up to publish. Hours inside a
 * day, days inside two weeks, weeks inside two months, months beyond. Absent
 * stamps say so rather than guessing.
 */
export function lastOnDutyPhrase(lastOnDutyAt: number | undefined, asOf: number) {
  if (lastOnDutyAt === undefined || !Number.isFinite(lastOnDutyAt)) {
    return "Not seen on duty yet.";
  }
  const ageMs = Math.max(0, asOf - lastOnDutyAt);
  const hour = 3_600_000;
  const day = 24 * hour;
  if (ageMs < hour) {
    return "Last on duty less than an hour ago.";
  }
  if (ageMs < 2 * day) {
    return `Last on duty ${coarseRelative.format(-Math.floor(ageMs / hour), "hour")}.`;
  }
  if (ageMs < 14 * day) {
    return `Last on duty ${coarseRelative.format(-Math.floor(ageMs / day), "day")}.`;
  }
  if (ageMs < 61 * day) {
    return `Last on duty ${coarseRelative.format(-Math.floor(ageMs / (7 * day)), "week")}.`;
  }
  return `Last on duty ${coarseRelative.format(-Math.floor(ageMs / (30 * day)), "month")}.`;
}
