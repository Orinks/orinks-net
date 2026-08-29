import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /downloads/music.pak", () => {
  afterEach(() => delete process.env.FREIGHT_FATE_MUSIC_BLOB_URL);

  it("redirects the stable path to public Blob storage", async () => {
    process.env.FREIGHT_FATE_MUSIC_BLOB_URL =
      "https://store-id.public.blob.vercel-storage.com/freight-fate/music.pak";

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(process.env.FREIGHT_FATE_MUSIC_BLOB_URL);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("fails closed when the Blob URL is unavailable", async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "The Freight Fate music pack cannot be downloaded right now. Try again later.",
    });
  });
});
