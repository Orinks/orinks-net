import "server-only";

import rawCatalog from "../../../data/trivia/clips.json";
import { validateClipCatalog } from "./catalog";

const validation = validateClipCatalog(rawCatalog);
if (validation.errors.length > 0) {
  const details = validation.errors
    .map((error) => `[${error.code}] ${error.path}: ${error.message}`)
    .join("\n");
  throw new Error(`Invalid mystery clip catalog:\n${details}`);
}

const clipsById = new Map(validation.clips.map((clip) => [clip.id, clip]));

export function getClipByOpaqueId(opaqueId: string) {
  return clipsById.get(opaqueId);
}
