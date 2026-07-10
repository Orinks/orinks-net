import {
  canonicalHttpsUrl,
  compactObject,
  normalizeText,
  requireAccessDate,
  uniqueStrings,
} from "../lib/normalize.mjs";
import { createRateLimitedRequester } from "../lib/request.mjs";

const API_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const DEPARTMENT_ID = 18;
const RIGHTS_URL = "https://www.metmuseum.org/policies/image-resources";

export function normalizeMetObject(raw, accessedAt) {
  const sourceId = normalizeText(raw?.objectID);
  const title = normalizeText(raw?.title || raw?.objectName);
  if (!sourceId || !title) return null;

  const url = canonicalHttpsUrl(
    raw.objectURL,
    `https://www.metmuseum.org/art/collection/search/${sourceId}`,
  );
  const publicDomain = raw.isPublicDomain === true;
  const makers = (raw.constituents ?? [])
    .map((entry) =>
      compactObject({ name: normalizeText(entry?.name), role: normalizeText(entry?.role) }),
    )
    .filter((entry) => entry.name);

  return {
    source: "met",
    sourceId,
    publisher: "The Metropolitan Museum of Art",
    title,
    url,
    accessedAt: requireAccessDate(accessedAt),
    rights: {
      status: publicDomain ? "public-domain" : "unknown",
      statement: publicDomain
        ? "The Met marks this object as public domain. Verify any linked media against the item page before reuse."
        : "The Met does not mark this object as public domain. Verify object and media rights on the item page.",
      url: RIGHTS_URL,
    },
    facts: compactObject({
      accessionNumber: normalizeText(raw.accessionNumber),
      objectType: normalizeText(raw.objectName),
      department: normalizeText(raw.department),
      culture: normalizeText(raw.culture),
      period: normalizeText(raw.period),
      objectDate: normalizeText(raw.objectDate),
      beginYear: Number.isInteger(raw.objectBeginDate) ? raw.objectBeginDate : undefined,
      endYear: Number.isInteger(raw.objectEndDate) ? raw.objectEndDate : undefined,
      makers,
      medium: normalizeText(raw.medium),
      dimensions: normalizeText(raw.dimensions),
      creditLine: normalizeText(raw.creditLine),
      geography: uniqueStrings([
        raw.country,
        raw.region,
        raw.subregion,
        raw.locale,
        raw.city,
      ]),
      tags: uniqueStrings((raw.tags ?? []).map((tag) => tag?.term)),
    }),
  };
}

export async function collectMet({
  limit,
  accessedAt,
  request = createRateLimitedRequester({ minIntervalMs: 250 }),
}) {
  const idsUrl = new URL(`${API_BASE}/objects`);
  idsUrl.searchParams.set("departmentIds", String(DEPARTMENT_ID));
  const index = await request(idsUrl.toString());
  const ids = Array.isArray(index?.objectIDs) ? index.objectIDs : [];
  const items = [];
  const scanLimit = Math.min(ids.length, Math.max(limit * 5, limit + 5));

  for (const id of ids.slice(0, scanLimit)) {
    try {
      const raw = await request(`${API_BASE}/objects/${encodeURIComponent(id)}`);
      const item = normalizeMetObject(raw, accessedAt);
      if (item) items.push(item);
      if (items.length >= limit) break;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  return items;
}
