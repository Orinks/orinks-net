import type { ClipCatalogRecord } from "./types";
import { ClipStreamError } from "./types";
import { openAudiusStream } from "./providers/audius";
import { openFeedClipsStream } from "./providers/feedClips";
import { openRemoteOpenStream } from "./providers/remoteOpen";

export interface OpenClipStreamOptions {
  fetchImpl?: typeof fetch;
  range?: string;
  signal?: AbortSignal;
}

export async function openProviderStream(
  record: ClipCatalogRecord,
  options: OpenClipStreamOptions = {},
) {
  switch (record.provider) {
    case "audius":
      return openAudiusStream(record, options);
    case "remote-open":
      return openRemoteOpenStream(record, options);
    case "feed-clips":
      return openFeedClipsStream(record);
    default:
      throw new ClipStreamError("provider.unsupported", "Clip provider is not supported.", 500);
  }
}
