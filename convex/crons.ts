import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Freight Fate's write rate limiter keeps one counter per driver and rolls it
// over in place, so all that is left to sweep is drivers who have stopped
// playing — plus the window-keyed rows the old scheme left behind. Hourly is
// plenty against a day-long retention, and the pass is batched.
crons.interval(
  "clear spent Freight Fate rate limit counters",
  { hours: 1 },
  internal.freightFateRateLimit.cleanupFreightFateRateLimits,
  {},
);

// Uploads rejected for self-contradicting arithmetic are kept so a human can
// review the verdict before deciding anything. Each row carries a whole save
// payload, so the review window is finite: sweep what has aged past it. Daily
// is plenty for a ninety-day window, and the pass is batched.
crons.interval(
  "drop reviewed-window Freight Fate rejected uploads",
  { hours: 24 },
  internal.freightFateSaves.pruneRejectedUploads,
  {},
);

// Activation rows live ten minutes unclaimed, and a claim restarts a
// two-minute collection window, so the longest-lived row is one claimed at
// the last second: about twelve minutes. They are deleted the moment they
// are redeemed, so all this sweeps is codes nobody finished. Hourly is
// plenty against a twelve-minute ceiling, and the pass is batched.
crons.interval(
  "drop expired Freight Fate activations",
  { hours: 1 },
  internal.freightFateActivation.sweepExpiredActivations,
  {},
);

// Drivers whose game stopped talking to us. Expiry used to ride along on
// heartbeat writes, which worked while every beat touched the board table;
// now that a beat usually writes nothing there, a crashed game would sit on
// the board until somebody else changed status. Every minute against a
// six-minute window, and a tick with nobody overdue reads one empty index
// range and writes nothing -- which is the point, because a sweep that wrote
// every tick would wake every browser watching the board once a minute.
crons.interval(
  "drop Freight Fate drivers whose heartbeat stopped",
  { minutes: 1 },
  internal.freightFate.sweepStalePresence,
  {},
);

export default crons;
