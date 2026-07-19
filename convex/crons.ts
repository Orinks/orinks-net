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

export default crons;
