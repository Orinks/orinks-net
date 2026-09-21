import { httpRouter } from "convex/server";
import { decideFromPage, reviewPage } from "./freightFateReview";

const http = httpRouter();

// The owner's Accept and Decline links from the Freight Fate review digest.
http.route({ path: "/freight-fate/review", method: "GET", handler: reviewPage });
http.route({ path: "/freight-fate/review", method: "POST", handler: decideFromPage });

export default http;
