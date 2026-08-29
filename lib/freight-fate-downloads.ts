export function getFreightFateMusicBlobUrl(
  env: NodeJS.ProcessEnv = process.env,
): URL {
  const raw = env.FREIGHT_FATE_MUSIC_BLOB_URL;
  if (!raw) {
    throw new Error("FREIGHT_FATE_MUSIC_BLOB_URL is not configured");
  }

  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    url.pathname !== "/freight-fate/music.pak"
  ) {
    throw new Error(
      "FREIGHT_FATE_MUSIC_BLOB_URL must name the public Freight Fate music blob",
    );
  }

  return url;
}
