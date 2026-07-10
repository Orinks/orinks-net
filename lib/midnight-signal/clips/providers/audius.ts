import type { ClipCatalogRecord } from "../types";
import { ClipStreamError } from "../types";

const API_BASE = "https://api.audius.co/v1/tracks";

function deadline(signal: AbortSignal | undefined, milliseconds: number) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  genre?: string;
  release_date?: string;
  is_streamable?: boolean;
  parental_warning_type?: string | null;
  cover_original_song_title?: string | null;
  remix_of?: { tracks?: unknown[] } | null;
  access?: { stream?: boolean } | null;
  permalink?: string;
  user?: { name?: string; is_verified?: boolean } | null;
}

function sameText(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.normalize("NFC").trim().toLocaleLowerCase("en-US") ===
      right.normalize("NFC").trim().toLocaleLowerCase("en-US")
  );
}

function validateLiveTrack(record: ClipCatalogRecord, track: AudiusTrack) {
  if (track.id !== record.providerAssetId) {
    throw new ClipStreamError("audius.metadata.id", "Audius returned a mismatched track.");
  }
  if (!track.is_streamable || track.access?.stream === false) {
    throw new ClipStreamError("audius.withdrawn", "Audius track is no longer streamable.", 410);
  }
  if (track.parental_warning_type) {
    throw new ClipStreamError("audius.explicit", "Explicit Audius tracks are not enabled.", 410);
  }
  if ((track.remix_of?.tracks?.length ?? 0) > 0) {
    throw new ClipStreamError("audius.remix", "Audius remix rights require separate review.", 410);
  }
  if (track.cover_original_song_title) {
    throw new ClipStreamError("audius.cover", "Audius cover rights require separate review.", 410);
  }
  if (!track.user?.is_verified) {
    throw new ClipStreamError("audius.creator.unverified", "Audius uploader is not verified.", 410);
  }
  if (!sameText(track.user.name, record.artistPublished.uploader)) {
    throw new ClipStreamError("audius.creator.mismatch", "Audius creator attribution changed.", 410);
  }
  if (!sameText(track.title, record.artistPublished.title)) {
    throw new ClipStreamError("audius.title.mismatch", "Audius track title attribution changed.", 410);
  }
  const expectedSourceUrl = track.permalink ? `https://audius.co${track.permalink}` : "";
  if (!sameText(expectedSourceUrl, record.artistPublished.permalink)) {
    throw new ClipStreamError("audius.source.mismatch", "Audius canonical track URL changed.", 410);
  }
  if (!sameText(track.genre, record.artistPublished.genre)) {
    throw new ClipStreamError("audius.genre.mismatch", "Audius track genre metadata changed.", 410);
  }
  if (!sameText(track.release_date, record.artistPublished.releasedAt)) {
    throw new ClipStreamError(
      "audius.release_date.mismatch",
      "Audius track release metadata changed.",
      410,
    );
  }
}

async function loadMetadata(
  record: ClipCatalogRecord,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(`${API_BASE}/${encodeURIComponent(record.providerAssetId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: deadline(signal, 10_000),
  });
  if (!response.ok) {
    throw new ClipStreamError(
      "audius.metadata.http",
      `Audius metadata returned HTTP ${response.status}.`,
      response.status === 404 ? 410 : 503,
    );
  }
  let payload: { data?: AudiusTrack };
  try {
    payload = (await response.json()) as { data?: AudiusTrack };
  } catch {
    throw new ClipStreamError("audius.metadata.json", "Audius metadata was not valid JSON.");
  }
  if (!payload.data) {
    throw new ClipStreamError("audius.metadata.missing", "Audius metadata was incomplete.");
  }
  validateLiveTrack(record, payload.data);
}

export async function openAudiusStream(
  record: ClipCatalogRecord,
  {
    fetchImpl = fetch,
    range,
    signal,
  }: { fetchImpl?: typeof fetch; range?: string; signal?: AbortSignal } = {},
) {
  if (record.provider !== "audius") {
    throw new ClipStreamError("audius.provider", "Clip is not an Audius record.", 500);
  }
  await loadMetadata(record, fetchImpl, signal);

  const headers = new Headers({ Accept: "audio/*" });
  if (range) headers.set("Range", range);
  const response = await fetchImpl(
    `${API_BASE}/${encodeURIComponent(record.providerAssetId)}/stream`,
    {
      cache: "no-store",
      headers,
      redirect: "follow",
      signal: deadline(signal, 30_000),
    },
  );
  if (response.status !== 200 && response.status !== 206) {
    throw new ClipStreamError(
      "audius.stream.http",
      `Audius stream returned HTTP ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!contentType.startsWith("audio/")) {
    throw new ClipStreamError("audius.stream.content_type", "Audius stream was not audio.");
  }
  return response;
}
