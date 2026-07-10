import { describe, expect, test } from "vitest";
import { feedClipsConfiguration, openFeedClipsStream } from "./feedClips";

describe("Feed Clips contract gate", () => {
  test("is disabled unless the agreement, territories, credentials, and endpoint are explicit", () => {
    expect(feedClipsConfiguration({})).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    expect(
      feedClipsConfiguration({
        FEED_CLIPS_ENABLED: "true",
        FEED_CLIPS_CONTRACT_CONFIRMED: "true",
        FEED_CLIPS_ALLOWED_TERRITORIES: "US,CA",
        FEED_CLIPS_API_BASE: "https://clips.example.feed.fm",
        FEED_CLIPS_API_KEY: "present-in-server-environment",
        FEED_CLIPS_SIGNING_SECRET: "present-in-server-environment",
      }),
    ).toEqual({ enabled: true, missing: [] });
  });

  test("never fabricates a provider request before contract-specific implementation", async () => {
    await expect(openFeedClipsStream()).rejects.toMatchObject({
      code: "feed_clips.disabled",
    });
  });
});
