import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Freight Fate's write rate limiter keys each counter to a one-minute window,
// so an active driver leaves a spent row behind every minute they play and
// nothing ever reads it again. Sweep them; the pass is batched, so a five
// minute tick drains a backlog steadily without ever running long.
crons.interval(
  "clear spent Freight Fate rate limit counters",
  { minutes: 5 },
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
