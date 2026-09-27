import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { decideFromPage, reviewPage } from "./freightFateReview";
import { answerPresencePost } from "./freightFateRequest";

const http = httpRouter();

// The owner's Accept and Decline links from the Freight Fate review digest.
http.route({ path: "/freight-fate/review", method: "GET", handler: reviewPage });
http.route({ path: "/freight-fate/review", method: "POST", handler: decideFromPage });

// The game's presence heartbeat. next.config.ts rewrites orinks.net's
// authenticated /api/freight-fate/presence requests here, so the site's most
// frequent call costs one mutation instead of a Vercel function as well.
http.route({
  path: "/freight-fate/presence",
  method: "POST",
  handler: httpAction((ctx, request) =>
    answerPresencePost(request, (args) => ctx.runMutation(api.freightFate.updatePresence, args)),
  ),
});

export default http;
