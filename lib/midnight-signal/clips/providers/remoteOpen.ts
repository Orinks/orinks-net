import type { ClipCatalogRecord } from "../types";
import { ClipStreamError } from "../types";

function deadline(signal: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isPrivateHost(hostname: string) {
  const normalized = hostname.toLocaleLowerCase("en-US");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized === "::1" || normalized === "[::1]") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function streamUrl(record: ClipCatalogRecord) {
  if (record.provider !== "remote-open") {
    throw new ClipStreamError("remote_open.provider", "Clip is not a remote-open record.", 500);
  }
  let parsed: URL;
  try {
    parsed = new URL(record.providerAssetId);
  } catch {
    throw new ClipStreamError("remote_open.url", "Remote-open stream URL is invalid.", 410);
  }
  if (parsed.protocol !== "https:" || isPrivateHost(parsed.hostname)) {
    throw new ClipStreamError("remote_open.url", "Remote-open stream URL is not allowed.", 410);
  }
  return parsed.toString();
}

export async function openRemoteOpenStream(
  record: ClipCatalogRecord,
  {
    fetchImpl = fetch,
    range,
    signal,
  }: { fetchImpl?: typeof fetch; range?: string; signal?: AbortSignal } = {},
) {
  const headers = new Headers({ Accept: "audio/*" });
  if (range) headers.set("Range", range);
  const response = await fetchImpl(streamUrl(record), {
    cache: "no-store",
    headers,
    redirect: "manual",
    signal: deadline(signal),
  });
  if (response.status !== 200 && response.status !== 206) {
    throw new ClipStreamError(
      "remote_open.http",
      `Remote-open stream returned HTTP ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!contentType.startsWith("audio/")) {
    throw new ClipStreamError("remote_open.content_type", "Remote-open stream was not audio.");
  }
  return response;
}
