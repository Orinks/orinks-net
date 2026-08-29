import { describe, expect, it } from "vitest";
import { getFreightFateMusicBlobUrl } from "./freight-fate-downloads";

describe("getFreightFateMusicBlobUrl", () => {
  it("accepts only an HTTPS public Vercel Blob URL", () => {
    const url = getFreightFateMusicBlobUrl(
      {
        FREIGHT_FATE_MUSIC_BLOB_URL:
          "https://store-id.public.blob.vercel-storage.com/freight-fate/music.pak",
      } as unknown as NodeJS.ProcessEnv,
    );
    expect(url.pathname).toBe("/freight-fate/music.pak");
  });

  it.each([undefined, "http://example.com/music.pak", "https://example.com/music.pak"])(
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
