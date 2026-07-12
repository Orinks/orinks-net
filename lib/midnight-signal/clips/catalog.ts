import type {
  ArtistPublishedMetadataSnapshot,
  ClipAttribution,
  ClipCatalogRecord,
  ClipCatalogValidationIssue,
  ClipCatalogValidationResult,
  ClipProvider,
} from "./types";

const PROVIDERS = new Set<ClipProvider>(["audius", "feed-clips", "remote-open"]);
const RECORD_KEYS = new Set([
  "id",
  "provider",
  "providerAssetId",
  "startSeconds",
  "durationSeconds",
  "textClue",
  "accessedAt",
  "artistPublished",
  "attribution",
]);
const ARTIST_PUBLISHED_KEYS = new Set([
  "uploader",
  "uploaderVerified",
  "title",
  "permalink",
  "genre",
  "releasedAt",
  "streamable",
  "explicit",
  "cover",
  "remix",
]);
const ATTRIBUTION_KEYS = new Set([
  "creator",
  "copyrightNotice",
  "licenseTitle",
  "licenseUrl",
  "sourceTitle",
  "sourceUrl",
]);
const OPAQUE_ID_PATTERN = /^ms-clip-[a-f0-9]{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  errors: ClipCatalogValidationIssue[],
  code: string,
  path: string,
  message: string,
) {
  errors.push({ code, path, message });
}

function requiredText(
  value: unknown,
  errors: ClipCatalogValidationIssue[],
  code: string,
  path: string,
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issue(errors, code, path, "Expected a non-empty string.");
    return false;
  }
  if (value !== value.normalize("NFC")) {
    issue(errors, `${code}.nfc`, path, "Text must use Unicode NFC normalization.");
    return false;
  }
  return true;
}

function httpsUrl(
  value: unknown,
  errors: ClipCatalogValidationIssue[],
  code: string,
  path: string,
): URL | null {
  if (!requiredText(value, errors, code, path)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      issue(errors, code, path, "URL must use HTTPS.");
      return null;
    }
    return parsed;
  } catch {
    issue(errors, code, path, "Expected an absolute HTTPS URL.");
    return null;
  }
}

function strictDate(
  value: unknown,
  errors: ClipCatalogValidationIssue[],
  code: string,
  path: string,
) {
  if (!requiredText(value, errors, code, path)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !DATE_PATTERN.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    issue(errors, code, path, "Expected a real calendar date in YYYY-MM-DD form.");
    return false;
  }
  return true;
}

function utcTimestamp(
  value: unknown,
  errors: ClipCatalogValidationIssue[],
  code: string,
  path: string,
) {
  if (!requiredText(value, errors, code, path)) return false;
  if (!UTC_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    issue(errors, code, path, "Expected an ISO 8601 UTC timestamp ending in Z.");
    return false;
  }
  return true;
}

function sameText(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.normalize("NFC").trim().toLocaleLowerCase("en-US") ===
      right.normalize("NFC").trim().toLocaleLowerCase("en-US")
  );
}

function validateArtistPublished(
  value: unknown,
  provider: unknown,
  errors: ClipCatalogValidationIssue[],
  path: string,
): value is ArtistPublishedMetadataSnapshot {
  if (!isRecord(value)) {
    issue(
      errors,
      "clip.artist_published",
      path,
      "Artist-published metadata must be a complete snapshot object.",
    );
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!ARTIST_PUBLISHED_KEYS.has(key)) {
      issue(errors, "clip.artist_published.field", `${path}.${key}`, `Unknown field "${key}".`);
    }
  }
  for (const field of ["uploader", "title", "genre"] as const) {
    requiredText(
      value[field],
      errors,
      `clip.artist_published.${field}`,
      `${path}.${field}`,
    );
  }
  const permalink = httpsUrl(
    value.permalink,
    errors,
    "clip.artist_published.permalink",
    `${path}.permalink`,
  );
  utcTimestamp(
    value.releasedAt,
    errors,
    "clip.artist_published.released_at",
    `${path}.releasedAt`,
  );
  for (const field of [
    "uploaderVerified",
    "streamable",
    "explicit",
    "cover",
    "remix",
  ] as const) {
    if (typeof value[field] !== "boolean") {
      issue(
        errors,
        `clip.artist_published.${field}`,
        `${path}.${field}`,
        "Expected a boolean snapshot value.",
      );
    }
  }
  if (value.uploaderVerified !== true || value.streamable !== true) {
    issue(
      errors,
      "clip.artist_published.eligibility",
      path,
      "Launch clips require a verified uploader and a streamable source snapshot.",
    );
  }
  if (value.explicit !== false || value.cover !== false || value.remix !== false) {
    issue(
      errors,
      "clip.artist_published.exclusions",
      path,
      "Explicit, cover, and remix recordings are excluded from launch clips.",
    );
  }
  if (
    provider === "audius" &&
    permalink &&
    permalink.hostname !== "audius.co" &&
    permalink.hostname !== "www.audius.co"
  ) {
    issue(
      errors,
      "clip.artist_published.audius_permalink",
      `${path}.permalink`,
      "Audius metadata must retain the canonical Audius track URL.",
    );
  }
  return true;
}

function validateAttribution(
  value: unknown,
  provider: unknown,
  errors: ClipCatalogValidationIssue[],
  path: string,
): value is ClipAttribution {
  if (!isRecord(value)) {
    issue(errors, "clip.attribution", path, "Attribution must be a complete object.");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!ATTRIBUTION_KEYS.has(key)) {
      issue(errors, "clip.attribution.field", `${path}.${key}`, `Unknown field "${key}".`);
    }
  }
  for (const field of ["creator", "copyrightNotice", "licenseTitle", "sourceTitle"] as const) {
    requiredText(value[field], errors, `clip.attribution.${field}`, `${path}.${field}`);
  }
  const licenseUrl = httpsUrl(
    value.licenseUrl,
    errors,
    "clip.attribution.license_url",
    `${path}.licenseUrl`,
  );
  const sourceUrl = httpsUrl(
    value.sourceUrl,
    errors,
    "clip.attribution.source_url",
    `${path}.sourceUrl`,
  );

  if (provider === "audius") {
    if (licenseUrl?.hostname !== "audius.org" || licenseUrl.pathname !== "/open-music-license.pdf") {
      issue(
        errors,
        "clip.attribution.audius_license",
        `${path}.licenseUrl`,
        "Audius clips must cite the official Audius Open Music License.",
      );
    }
    if (sourceUrl && sourceUrl.hostname !== "audius.co" && sourceUrl.hostname !== "www.audius.co") {
      issue(
        errors,
        "clip.attribution.audius_source",
        `${path}.sourceUrl`,
        "Audius clips must link to the canonical Audius track page.",
      );
    }
  }

  return true;
}

function validateRecord(
  value: unknown,
  index: number,
): { clip: ClipCatalogRecord | null; errors: ClipCatalogValidationIssue[] } {
  const errors: ClipCatalogValidationIssue[] = [];
  const path = `clips[${index}]`;
  if (!isRecord(value)) {
    issue(errors, "clip.object", path, "Clip must be an object.");
    return { clip: null, errors };
  }
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) issue(errors, "clip.field", `${path}.${key}`, `Unknown field "${key}".`);
  }

  if (
    requiredText(value.id, errors, "clip.id", `${path}.id`) &&
    !OPAQUE_ID_PATTERN.test(value.id)
  ) {
    issue(
      errors,
      "clip.id.opaque",
      `${path}.id`,
      "Public clip IDs must use a nonsemantic ms-clip plus eight-hex token.",
    );
  }
  if (typeof value.provider !== "string" || !PROVIDERS.has(value.provider as ClipProvider)) {
    issue(errors, "clip.provider", `${path}.provider`, "Clip provider is not supported.");
  }
  requiredText(
    value.providerAssetId,
    errors,
    "clip.provider_asset",
    `${path}.providerAssetId`,
  );
  if (
    typeof value.startSeconds !== "number" ||
    !Number.isFinite(value.startSeconds) ||
    value.startSeconds < 0
  ) {
    issue(errors, "clip.start", `${path}.startSeconds`, "Start must be a finite non-negative number.");
  }
  if (
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 10 ||
    value.durationSeconds > 15
  ) {
    issue(
      errors,
      "clip.duration",
      `${path}.durationSeconds`,
      "Duration must be between 10 and 15 seconds.",
    );
  }
  requiredText(value.textClue, errors, "clip.text_clue", `${path}.textClue`);
  strictDate(value.accessedAt, errors, "clip.accessed_at", `${path}.accessedAt`);
  const artistPublished = value.artistPublished;
  const attribution = value.attribution;
  const artistPublishedValid = validateArtistPublished(
    artistPublished,
    value.provider,
    errors,
    `${path}.artistPublished`,
  );
  const attributionValid = validateAttribution(
    attribution,
    value.provider,
    errors,
    `${path}.attribution`,
  );
  if (artistPublishedValid && attributionValid) {
    if (!sameText(artistPublished.uploader, attribution.creator)) {
      issue(
        errors,
        "clip.rights.creator_mismatch",
        `${path}.artistPublished.uploader`,
        "Metadata uploader must match the retained attribution creator.",
      );
    }
    if (!sameText(artistPublished.title, attribution.sourceTitle)) {
      issue(
        errors,
        "clip.rights.title_mismatch",
        `${path}.artistPublished.title`,
        "Metadata title must match the retained attribution source title.",
      );
    }
    if (!sameText(artistPublished.permalink, attribution.sourceUrl)) {
      issue(
        errors,
        "clip.rights.permalink_mismatch",
        `${path}.artistPublished.permalink`,
        "Metadata permalink must match the retained attribution source URL.",
      );
    }
  }

  return {
    clip: errors.length === 0 ? (value as unknown as ClipCatalogRecord) : null,
    errors,
  };
}

export function validateClipCatalog(value: unknown): ClipCatalogValidationResult {
  const errors: ClipCatalogValidationIssue[] = [];
  const clips: ClipCatalogRecord[] = [];
  if (!isRecord(value) || !Array.isArray(value.clips)) {
    issue(errors, "catalog.clips", "clips", "Clip catalog must contain a clips array.");
    return { clips, errors };
  }

  const ids = new Map<string, number>();
  const providerAssets = new Map<string, number>();
  value.clips.forEach((rawClip, index) => {
    const result = validateRecord(rawClip, index);
    errors.push(...result.errors);
    if (!result.clip) return;
    const clip = result.clip;
    const previousId = ids.get(clip.id);
    if (previousId !== undefined) {
      issue(errors, "clip.id.duplicate", `clips[${index}].id`, `Duplicates clips[${previousId}].id.`);
    } else {
      ids.set(clip.id, index);
    }
    const assetKey = `${clip.provider}:${clip.providerAssetId}`;
    const previousAsset = providerAssets.get(assetKey);
    if (previousAsset !== undefined) {
      issue(
        errors,
        "clip.provider_asset.duplicate",
        `clips[${index}].providerAssetId`,
        `Duplicates clips[${previousAsset}].providerAssetId.`,
      );
    } else {
      providerAssets.set(assetKey, index);
    }
    clips.push(clip);
  });

  return { clips, errors };
}
