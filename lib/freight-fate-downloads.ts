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
    url.hostname !== "crisp-crystal-9a9y.here.now" ||
    url.pathname !== "/music.pak"
  ) {
    throw new Error(
      "FREIGHT_FATE_MUSIC_BLOB_URL must name the permanent Freight Fate music file",
    );
  }

  return url;
}

/** Channel 3000's clips, beside the music pack on the same here.now site. */
export const FREIGHT_FATE_CHANNEL_3000_PACK_URL =
  "https://crisp-crystal-9a9y.here.now/channel3000.pak";
