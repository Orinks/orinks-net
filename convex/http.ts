import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { clerkWebhook } from "./accountDeletion";
import { decideFromPage, reviewPage } from "./freightFateReview";
import { answerBoardGet, answerDirectoryGet } from "./freightFatePublicReads";
import { answerPresencePost } from "./freightFateRequest";
import { decideStationFromPage, stationReviewPage } from "./freightFateStations";

const http = httpRouter();

// The owner's Accept and Decline links from the Freight Fate review digest.
http.route({ path: "/freight-fate/review", method: "GET", handler: reviewPage });
http.route({ path: "/freight-fate/review", method: "POST", handler: decideFromPage });

// The same, for the daily digest of radio stations players suggested.
http.route({ path: "/freight-fate/station-review", method: "GET", handler: stationReviewPage });
http.route({ path: "/freight-fate/station-review", method: "POST", handler: decideStationFromPage });

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

// The game's public reads: the drivers board (same path as the heartbeat,
// GET instead of POST) and the driver directory. Builds from before these
// existed still poll orinks.net, whose routes answer as they always have.
http.route({ path: "/freight-fate/presence", method: "GET", handler: answerBoardGet });
http.route({ path: "/freight-fate/directory", method: "GET", handler: answerDirectoryGet });

// Clerk's account events. Only user.deleted is acted on: it is the one thing
// the site cannot learn any other way, and until it arrived a deleted account
// left its driver, saves and journal behind (convex/accountDeletion.ts).
http.route({ path: "/clerk/webhook", method: "POST", handler: clerkWebhook });

export default http;
