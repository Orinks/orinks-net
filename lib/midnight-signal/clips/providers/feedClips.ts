import type { ClipCatalogRecord } from "../types";
import { ClipStreamError } from "../types";

const REQUIRED_SETTINGS = [
  "FEED_CLIPS_ALLOWED_TERRITORIES",
  "FEED_CLIPS_API_BASE",
  "FEED_CLIPS_API_KEY",
  "FEED_CLIPS_SIGNING_SECRET",
] as const;

export function feedClipsConfiguration(
  environment: Record<string, string | undefined> = process.env,
) {
  const missing: string[] = [];
  if (environment.FEED_CLIPS_ENABLED !== "true") missing.push("FEED_CLIPS_ENABLED");
  if (environment.FEED_CLIPS_CONTRACT_CONFIRMED !== "true") {
    missing.push("FEED_CLIPS_CONTRACT_CONFIRMED");
  }
  for (const name of REQUIRED_SETTINGS) {
    if (!environment[name]?.trim()) missing.push(name);
  }
  return { enabled: missing.length === 0, missing };
}

export async function openFeedClipsStream(
  _record?: ClipCatalogRecord,
  { environment = process.env }: { environment?: Record<string, string | undefined> } = {},
): Promise<Response> {
  const configuration = feedClipsConfiguration(environment);
  if (!configuration.enabled) {
    throw new ClipStreamError(
      "feed_clips.disabled",
      "Feed Clips is disabled until its commercial contract is configured.",
    );
  }
  throw new ClipStreamError(
    "feed_clips.adapter_pending_contract",
    "Feed Clips request signing must be implemented from the executed provider contract.",
  );
}
