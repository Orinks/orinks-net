import { describe, expect, it } from "vitest";
import { getFreightFateMusicBlobUrl } from "./freight-fate-downloads";

describe("getFreightFateMusicBlobUrl", () => {
  it("accepts only the verified HTTPS here.now music URL", () => {
    const url = getFreightFateMusicBlobUrl(
      {
        FREIGHT_FATE_MUSIC_BLOB_URL:
          "https://crisp-crystal-9a9y.here.now/music.pak",
      } as unknown as NodeJS.ProcessEnv,
    );
    expect(url.pathname).toBe("/music.pak");
  });

  it.each([
    undefined,
    "http://crisp-crystal-9a9y.here.now/music.pak",
    "https://example.com/music.pak",
    "https://crisp-crystal-9a9y.here.now/not-music.pak",
  ])(
    "rejects unsafe configuration %s",
    (value) => {
      expect(() =>
        getFreightFateMusicBlobUrl({
          FREIGHT_FATE_MUSIC_BLOB_URL: value,
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/FREIGHT_FATE_MUSIC_BLOB_URL/);
    },
  );
});
