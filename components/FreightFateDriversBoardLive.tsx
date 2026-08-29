"use client";

import Link from "next/link";
import {
  ConvexProvider,
  ConvexReactClient,
  useConvexConnectionState,
  useQuery,
} from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  normalizeFreightFateDisplayName,
  stillOnDuty,
  type FreightFatePresenceBoard,
  type FreightFatePresenceDriver,
} from "@/lib/freight-fate-presence";

const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** How often the rendered list re-checks its own clock.
 *
 * Nothing is fetched on this tick. It exists because two things on this list
 * change with time alone and nothing writes to the backend to say so: a
 * driver who parks and goes quiet has to drop off, and every "updated N
 * minutes ago" has to stay true. Both stop while the list is held still.
 */
const CLOCK_TICK_MS = 60_000;

/** The least time between two spoken notices.
 *
 * A subscription can deliver several changes a second. Without a floor here,
 * a burst of drivers setting off at once produces overlapping speech, each
 * notice cutting off the one before it and all of them cutting off whatever
 * the listener was actually reading. Anything that happens inside the window
 * is gathered up and said once at the end of it.
 */
const NOTICE_THROTTLE_MS = 10_000;

/** How many rows are shown before the rest are behind a control.
 *
 * A hundred rows is about seven minutes of speech, by the end of which the
 * top of the list has changed -- so it can never be heard in one consistent
 * state. Twenty can.
 */
const ROWS_SHOWN = 20;

function countSentence(count: number) {
  if (count === 0) {
    return "No drivers are on duty right now.";
  }

  return `${count} ${count === 1 ? "driver is" : "drivers are"} on duty.`;
}

/** The count, frozen at the moment the listener stopped the list.
 *
 * Leaving "3 drivers are on duty" on screen while the list is held still
 * would let a true sentence go quietly false, for as long as they leave it
 * paused -- and they would have no way to tell.
 */
function pausedSentence(count: number) {
  const who =
    count === 0
      ? "No drivers were"
      : `${count} ${count === 1 ? "driver was" : "drivers were"}`;

  return `${who} on duty when you paused this list. Resume it to see who is on duty now.`;
}

const EXPLANATION =
  "This list updates itself: drivers appear when they go on duty and leave " +
  "when they stop driving. You don't need to refresh the page.";

const STOPPED =
  "This list has stopped updating. The drivers shown were on duty a few " +
  "minutes ago. This doesn't affect your game or your driver profile.";

/** Said only where the list really is a still frame: before the browser has
 * taken over, and for anyone without JavaScript. A reader has no page-load
 * cue either way, so this has to say which one they have. */
function checkedPhrase(asOf: number) {
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(asOf));

  return `This list was checked at ${stamp} Eastern. Refresh the page to check again.`;
}

function updatedPhrase(changedAt: number, asOf: number) {
  const ageMinutes = Math.round((asOf - changedAt) / 60_000);

  // Intl.RelativeTimeFormat throws on anything not finite, and this list is
  // built from a public endpoint, so a row missing its stamp would take the
  // whole section down rather than lose one phrase. Say nothing instead: the
  // driver, what they are doing and the link all still read.
  if (!Number.isFinite(ageMinutes)) {
    return "";
  }

  if (ageMinutes < 1) {
    return "Updated just now.";
  }

  return `Updated ${relativeTime.format(-ageMinutes, "minute")}.`;
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

/** Alphabetical, always.
 *
 * The backend sends the most recently changed drivers, which is the right
 * hundred to send and the wrong order to read: sorted by recency the list
 * reshuffles under anyone working down it, and a listener loses their place
 * every time a truck somewhere reports a few more percent. By name, an update
 * rewrites one line and moves nothing.
 */
function byName(drivers: FreightFatePresenceDriver[]) {
  return drivers
    .map((driver) => ({
      ...driver,
      displayName: normalizeFreightFateDisplayName(driver.displayName),
    }))
    .sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, "en-US") ||
        a.driverId.localeCompare(b.driverId),
    );
}

type Row = { driver: FreightFatePresenceDriver; goneOffDuty: boolean };

/** Names that two rows would say identically.
 *
 * Stored display names are already unique, case-insensitively, so this is
 * normally empty and costs nothing. What the uniqueness rule does not cover
 * is a moderated name: a masked driver renders as "Driver ab12" from their
 * own id, which never goes through the uniqueness table and can collide with
 * another mask or with a name somebody legitimately chose. Two rows that
 * sound the same become two entries a listener cannot tell apart in a list of
 * links, so those -- and only those -- carry a discriminator.
 */
function spokenTwice(rows: Row[]) {
  const seen = new Map<string, number>();
  for (const { driver } of rows) {
    const key = driver.displayName.toLocaleLowerCase("en-US");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return seen;
}

function DriverRows({
  rows,
  asOf,
  onFocusRow,
}: {
  rows: Row[];
  asOf: number;
  onFocusRow?: (driverId: string | null) => void;
}) {
  const shared = spokenTwice(rows);

  return (
    <ul
      // Entering by list navigation, a hundred bare rows announce as "list,
      // 100 items" and nothing else.
      aria-label="Drivers on duty"
      onFocus={(event) => {
        const id = (event.target as HTMLElement).dataset?.driverId;
        if (id) {
          onFocusRow?.(id);
        }
      }}
      onBlur={() => onFocusRow?.(null)}
    >
      {rows.map(({ driver, goneOffDuty }) => {
        const activity = driver.activity.trim();
        const detail = driver.detail.trim();
        const line = [
          sentence(activity),
          comparableSentence(detail) === comparableSentence(activity) ? "" : sentence(detail),
          goneOffDuty ? "Went off duty." : updatedPhrase(driver.changedAt, asOf),
        ]
          .filter(Boolean)
          .join(" ");

        return (
          // Keyed by driver so React keeps a focused row's element alive when
          // the rows around it are added, removed or re-sorted.
          <li key={driver.driverId}>
            <Link
              href={`/freight-fate/drivers/${driver.driverId}`}
              data-driver-id={driver.driverId}
              // Heard out of context in a list of links, a bare display name
              // gives no clue that it leads anywhere. The visible text stays a
              // leading substring of this, so saying what is on screen still
              // works. The four characters are the tail of the driver's own
              // id, which never changes -- a discriminator that moved would be
              // worse than none.
              aria-label={
                (shared.get(driver.displayName.toLocaleLowerCase("en-US")) ?? 0) > 1
                  ? `${driver.displayName}, driver profile ${driver.driverId.slice(-4)}`
                  : `${driver.displayName}, driver profile`
              }
            >
              {driver.displayName}
            </Link>
            {`: ${line}`}
          </li>
        );
      })}
    </ul>
  );
}

/** The still-frame list: what the server sent, and what anyone without
 * JavaScript keeps. */
function SnapshotBoard({ board }: { board: FreightFatePresenceBoard }) {
  const rows = byName(board.drivers).map((driver) => ({ driver, goneOffDuty: false }));

  return (
    <>
      <p>{countSentence(rows.length)}</p>
      <p>{checkedPhrase(board.asOf)}</p>
      <DriverRows rows={rows} asOf={board.asOf} />
    </>
  );
}

/** One always-mounted, screen-reader-only region, and everything spoken goes
 * through it.
 *
 * Never conditionally rendered: a region created and filled in the same
 * commit does not announce. Never a second region either -- JAWS drops
 * simultaneous writes to two of them, which is why the setup page settled on
 * one. The clear-then-set across two frames is what lets the same sentence be
 * said twice, since React will not re-fire an unchanged text node.
 */
function useAnnouncer() {
  const [message, setMessage] = useState("");

  const announce = useCallback((text: string) => {
    setMessage("");
    requestAnimationFrame(() => requestAnimationFrame(() => setMessage(text)));
  }, []);

  return { message, announce };
}

function LiveBoard({ initial }: { initial: FreightFatePresenceBoard }) {
  const live = useQuery(api.freightFate.getLivePresenceBoard, {});
  const connection = useConvexConnectionState();
  const { message, announce } = useAnnouncer();

  // Until the browser has hydrated, render exactly what the server sent --
  // same drivers, same stamp, same wording. Judging freshness against a
  // browser clock before then would have the two disagree and React would
  // throw the markup away.
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(initial.asOf);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // `live` stays undefined until the subscription answers, and forever if it
  // never does -- so a backend we cannot reach leaves the server's list on
  // screen instead of blanking it.
  const connected = mounted && live !== undefined;
  const stopped = connected && connection.hasEverConnected && !connection.isWebSocketConnected;

  const onDuty = useMemo(() => {
    if (!connected) {
      return byName(initial.drivers);
    }
    return byName(live!.drivers.filter((driver) => stillOnDuty(driver, now)));
  }, [connected, initial.drivers, live, now]);

  // Everything the listener can currently see, held still while paused.
  const [frozen, setFrozen] = useState<{ drivers: FreightFatePresenceDriver[]; asOf: number } | null>(null);
  const shownDrivers = paused && frozen ? frozen.drivers : onDuty;
  const shownAsOf = paused && frozen ? frozen.asOf : connected ? now : initial.asOf;

  // Drivers outlive the rows they came from, twice over: one who has just
  // left still has to be named in the notice about them leaving, and one the
  // listener is standing on has to stay renderable after the roster drops
  // them. Filled in an effect rather than during render, so a render is never
  // the thing that changes it.
  const lastKnown = useRef(new Map<string, FreightFatePresenceDriver>());

  // Speak only arrivals and departures, and only after the first live paint.
  // A driver reporting a few more percent of their trip changes a line and
  // says nothing, which is the whole point of diffing on who is here rather
  // than on what they are doing.
  const previousIds = useRef<Set<string> | null>(null);
  const pending = useRef({ arrived: [] as string[], departed: [] as string[] });
  const lastSpokeAt = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by flushNotices, which may fire on a timer long after the render
  // that scheduled it.
  const onDutyCount = useRef(0);

  const flushNotices = useCallback(() => {
    const { arrived, departed } = pending.current;
    pending.current = { arrived: [], departed: [] };
    flushTimer.current = null;
    if (arrived.length === 0 && departed.length === 0) {
      return;
    }
    lastSpokeAt.current = Date.now();

    const nameOf = (id: string) => lastKnown.current.get(id)?.displayName ?? "A driver";
    const changed = arrived.length + departed.length;
    announce(
      changed <= 2
        ? [
            ...arrived.map((id) => `${nameOf(id)} is on duty.`),
            ...departed.map((id) => `${nameOf(id)} went off duty.`),
          ].join(" ")
        : countSentence(onDutyCount.current),
    );
  }, [announce]);

  useEffect(() => {
    onDutyCount.current = onDuty.length;

    // Learn every name on sight. A driver has to still be nameable one render
    // after they leave, both to be spoken about and to be held on screen
    // under a reader's focus.
    const learn = () => {
      for (const driver of onDuty) {
        lastKnown.current.set(driver.driverId, driver);
      }
    };

    // Nothing live has arrived yet, so there is nothing to compare against.
    // Leaving the baseline unset here is what keeps the page arriving from
    // being reported as every driver on it setting off at once: the still
    // frame the server sent is not a previous state, it is the same state
    // seen earlier.
    if (!connected) {
      previousIds.current = null;
      learn();
      return;
    }

    const ids = new Set(onDuty.map((driver) => driver.driverId));
    const previous = previousIds.current;
    previousIds.current = ids;

    // The first live list is the baseline, not news. Nor is anything that
    // happens while the listener has the list held still -- and on resume
    // they get the fresh count in front of them rather than a backlog.
    if (!previous || paused) {
      learn();
      return;
    }

    for (const driver of onDuty) {
      if (!previous.has(driver.driverId)) {
        pending.current.arrived.push(driver.driverId);
      }
    }
    for (const id of previous) {
      if (!ids.has(id)) {
        pending.current.departed.push(id);
      }
    }
    // After the diff, never before: a departing driver's name has to survive
    // long enough to be spoken.
    learn();
    if (pending.current.arrived.length === 0 && pending.current.departed.length === 0) {
      return;
    }

    const wait = Math.max(0, NOTICE_THROTTLE_MS - (Date.now() - lastSpokeAt.current));
    if (wait === 0) {
      flushNotices();
    } else if (flushTimer.current === null) {
      flushTimer.current = setTimeout(flushNotices, wait);
    }
  }, [onDuty, connected, paused, flushNotices]);

  useEffect(() => () => {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
    }
  }, []);

  const toldAboutStop = useRef(false);
  useEffect(() => {
    if (stopped && !toldAboutStop.current) {
      toldAboutStop.current = true;
      announce(STOPPED);
    }
    if (!stopped) {
      toldAboutStop.current = false;
    }
  }, [stopped, announce]);

  // A row the listener is standing on is never taken away underneath them.
  // Losing it would drop focus to the top of the document mid-read, and the
  // idle sweep makes that a routine event rather than a rare one: parking on
  // a row to think about it is exactly what the sweep punishes.
  const rows: Row[] = useMemo(() => {
    const base = shownDrivers.map((driver) => ({ driver, goneOffDuty: false }));
    if (!focusedDriverId || base.some((row) => row.driver.driverId === focusedDriverId)) {
      return base;
    }
    const held = lastKnown.current.get(focusedDriverId);
    if (!held) {
      return base;
    }
    return byName([...shownDrivers, held]).map((driver) => ({
      driver,
      goneOffDuty: driver.driverId === focusedDriverId,
    }));
  }, [shownDrivers, focusedDriverId]);

  const capped = rows.length > ROWS_SHOWN && !expanded;
  const visibleRows = capped ? rows.slice(0, ROWS_SHOWN) : rows;

  function togglePause() {
    if (paused) {
      setFrozen(null);
      setPaused(false);
      announce("The drivers list is updating again.");
    } else {
      setFrozen({ drivers: onDuty, asOf: now });
      setPaused(true);
      announce("The drivers list is paused.");
    }
  }

  return (
    <>
      <div aria-atomic="true" className="sr-only" role="status">
        {message}
      </div>

      {/* Counted from who is actually on duty, never from the rendered rows:
          a row held open under someone's focus is a courtesy to that reader,
          not a driver. */}
      {paused ? (
        <p>{pausedSentence(shownDrivers.length)}</p>
      ) : (
        <>
          <p>{countSentence(shownDrivers.length)}</p>
          <p>{connected ? (stopped ? STOPPED : EXPLANATION) : checkedPhrase(initial.asOf)}</p>
        </>
      )}

      {/* Before the list, deliberately: a control for holding the list still
          is no use to anyone who has to wade through the list to reach it. */}
      {connected ? (
        <p>
          <button type="button" className="font-semibold text-action underline" onClick={togglePause}>
            {paused ? "Resume the drivers list" : "Pause the drivers list"}
          </button>
        </p>
      ) : null}

      {capped ? <p>{`Showing the first ${ROWS_SHOWN} of ${rows.length} drivers, by name.`}</p> : null}

      <DriverRows rows={visibleRows} asOf={shownAsOf} onFocusRow={setFocusedDriverId} />

      {rows.length > ROWS_SHOWN ? (
        <p>
          <button
            type="button"
            className="font-semibold text-action underline"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show fewer drivers" : `Show all ${rows.length} drivers`}
          </button>
        </p>
      ) : null}
    </>
  );
}

/** The drivers list, watching the backend for changes.
 *
 * Carries its own Convex client rather than borrowing the one under
 * /freight-fate/online: that one is bridged to a signed-in identity, and this
 * list is public. The query it subscribes to takes no arguments, so every
 * visitor watching shares a single cached execution on the backend and what
 * the list costs to run tracks what drivers do, not how many people are
 * looking at it.
 */
export function FreightFateDriversBoardLive({
  initial,
}: {
  initial: FreightFatePresenceBoard;
}) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });

  if (!client) {
    return <SnapshotBoard board={initial} />;
  }

  return (
    <ConvexProvider client={client}>
      <LiveBoard initial={initial} />
    </ConvexProvider>
  );
}
