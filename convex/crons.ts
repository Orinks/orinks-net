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

export default crons;
