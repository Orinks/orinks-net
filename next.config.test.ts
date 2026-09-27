import { describe, expect, test } from "vitest";
import { presenceRewrites } from "./next.config";

describe("presenceRewrites", () => {
  test("sends only the game's authenticated presence calls to the deployment's HTTP router", () => {
    expect(presenceRewrites("https://flexible-cod-674.convex.cloud")).toEqual([
      {
        source: "/api/freight-fate/presence",
        has: [{ type: "header", key: "authorization" }],
        destination: "https://flexible-cod-674.convex.site/freight-fate/presence",
      },
    ]);
  });

  test("leaves the Next route answering when there is no cloud deployment to point at", () => {
    expect(presenceRewrites(undefined)).toEqual([]);
    expect(presenceRewrites("http://127.0.0.1:3210")).toEqual([]);
  });
});
