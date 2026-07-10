export type ClipProvider = "audius" | "feed-clips" | "remote-open";

export interface ClipAttribution {
  creator: string;
  copyrightNotice: string;
  licenseTitle: string;
  licenseUrl: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface ArtistPublishedMetadataSnapshot {
  uploader: string;
  uploaderVerified: boolean;
  title: string;
  permalink: string;
  genre: string;
  releasedAt: string;
  streamable: boolean;
  explicit: boolean;
  cover: boolean;
  remix: boolean;
}

export interface ClipCatalogRecord {
  id: string;
  provider: ClipProvider;
  providerAssetId: string;
  startSeconds: number;
  durationSeconds: number;
  textClue: string;
  accessedAt: string;
  artistPublished: ArtistPublishedMetadataSnapshot;
  attribution: ClipAttribution;
}

export interface ClipCatalogValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ClipCatalogValidationResult {
  clips: ClipCatalogRecord[];
  errors: ClipCatalogValidationIssue[];
}

export class ClipStreamError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = "ClipStreamError";
    this.code = code;
    this.status = status;
  }
}
