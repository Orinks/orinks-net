import { describe, expect, test } from "vitest";
import rawCatalog from "../../../data/trivia/clips.json";
import { validateClipCatalog } from "./catalog";

function validAudiusClip(overrides: Record<string, unknown> = {}) {
  return {
    id: "ms-clip-7f3a91c2",
    provider: "audius",
    providerAssetId: "X6zzGva",
    startSeconds: 0,
    durationSeconds: 12,
    textClue: "A verified 2026 Audius release tagged as deep house.",
    accessedAt: "2026-07-10",
    artistPublished: {
      uploader: "Jazcardan",
      uploaderVerified: true,
      title: "Jazcardan - Funky Road",
      permalink: "https://audius.co/Jazcardan/jazcardan-funky-road",
      genre: "Deep House",
      releasedAt: "2026-07-03T21:00:00Z",
      streamable: true,
      explicit: false,
      cover: false,
      remix: false,
    },
    attribution: {
      creator: "Jazcardan",
      copyrightNotice: "Copyright © 2026 Jazcardan.",
      licenseTitle: "Audius Open Music License",
      licenseUrl: "https://audius.org/open-music-license.pdf",
      sourceTitle: "Jazcardan - Funky Road",
      sourceUrl: "https://audius.co/Jazcardan/jazcardan-funky-road",
    },
    ...overrides,
  };
}

describe("validateClipCatalog", () => {
  test("accepts every curated launch record", () => {
    const result = validateClipCatalog(rawCatalog);

    expect(result.errors).toEqual([]);
    expect(result.clips).toHaveLength(22);
  });

  test("accepts a complete short Audius clip with explicit attribution", () => {
    const result = validateClipCatalog({ clips: [validAudiusClip()] });

    expect(result.errors).toEqual([]);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].id).toBe("ms-clip-7f3a91c2");
  });

  test.each([
    ["provider asset", { providerAssetId: "" }],
    ["text clue", { textClue: "" }],
    ["access date", { accessedAt: "" }],
    ["artist-published metadata", { artistPublished: {} }],
    ["copyright notice", {
      attribution: {
        ...validAudiusClip().attribution,
        copyrightNotice: "",
      },
    }],
    ["license URL", {
      attribution: {
        ...validAudiusClip().attribution,
        licenseUrl: "http://audius.org/open-music-license.pdf",
      },
    }],
    ["source URL", {
      attribution: {
        ...validAudiusClip().attribution,
        sourceUrl: "https://example.com/not-the-track",
      },
    }],
  ])("rejects incomplete or untrusted %s metadata", (_label, overrides) => {
    const result = validateClipCatalog({ clips: [validAudiusClip(overrides)] });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.clips).toEqual([]);
  });

  test("rejects a route ID that contains answer-bearing words", () => {
    const result = validateClipCatalog({
      clips: [validAudiusClip({ id: "needle-drop-funky-road" })],
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "clip.id.opaque" }),
    );
  });

  test.each([9, 16, 0, Number.POSITIVE_INFINITY])(
    "rejects a clip duration outside the approved 10-15 second window: %s",
    (durationSeconds) => {
      const result = validateClipCatalog({
        clips: [validAudiusClip({ durationSeconds })],
      });

      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "clip.duration" }),
      );
    },
  );

  test("rejects duplicate opaque IDs and provider assets", () => {
    const first = validAudiusClip();
    const result = validateClipCatalog({
      clips: [
        first,
        validAudiusClip({
          id: "ms-clip-b4e82d16",
          providerAssetId: first.providerAssetId,
        }),
      ],
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "clip.provider_asset.duplicate" }),
    );
  });

  test("recognizes Feed Clips records but keeps activation outside catalog validation", () => {
    const result = validateClipCatalog({
      clips: [
        validAudiusClip({
          id: "ms-clip-29c7fd40",
          provider: "feed-clips",
          providerAssetId: "provider-opaque-asset",
          artistPublished: {
            ...validAudiusClip().artistPublished,
            uploader: "Contract-provided creator",
            title: "Contract-provided recording title",
            permalink: "https://www.feed.fm/products",
          },
          attribution: {
            ...validAudiusClip().attribution,
            creator: "Contract-provided creator",
            copyrightNotice: "Contract-provided copyright notice",
            licenseTitle: "Feed Clips commercial agreement",
            licenseUrl: "https://www.feed.fm/clips-terms-conditions",
            sourceTitle: "Contract-provided recording title",
            sourceUrl: "https://www.feed.fm/products",
          },
        }),
      ],
    });

    expect(result.errors).toEqual([]);
  });
});
