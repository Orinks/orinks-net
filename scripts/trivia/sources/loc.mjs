import {
  canonicalHttpsUrl,
  compactObject,
  contentValues,
  normalizeText,
  requireAccessDate,
  uniqueStrings,
} from "../lib/normalize.mjs";
import { createRateLimitedRequester } from "../lib/request.mjs";

const JUKEBOX_URL = "https://www.loc.gov/collections/national-jukebox/";
const JUKEBOX_FACET =
  "partof_repository:recorded sound section, library of congress|location:united states";

function sourceIdFromUrl(value) {
  const url = canonicalHttpsUrl(value);
  if (!url) return "";
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return normalizeText(parts.at(-1));
}

function itemRequestUrl(value) {
  const url = new URL(canonicalHttpsUrl(value));
  url.searchParams.set("fo", "json");
  url.searchParams.set("at", "item,resources");
  return url.toString();
}

export function normalizeLocItem(summary, detail, accessedAt) {
  const item = detail?.item ?? {};
  const url = canonicalHttpsUrl(item.id || item.url || summary?.id || summary?.url);
  const sourceId = normalizeText(item.item_id || summary?.item_id) || sourceIdFromUrl(url);
  const title = normalizeText(item.title || summary?.title);
  if (!sourceId || !title || !url) return null;

  const rightsStatements = uniqueStrings([
    ...contentValues(item.rights_advisory),
    ...contentValues(item.rights_information),
    ...contentValues(item.restriction),
    ...contentValues(summary?.rights_advisory),
    ...contentValues(summary?.rights_information),
  ]);
  const accessRestricted = item.access_restricted === true || summary?.access_restricted === true;

  return {
    source: "loc",
    sourceId,
    publisher: "Library of Congress",
    title,
    url,
    accessedAt: requireAccessDate(accessedAt),
    rights: {
      status: accessRestricted
        ? "restricted"
        : rightsStatements.length > 0
          ? "rights-advisory"
          : "unknown",
      statement:
        rightsStatements.join(" ") ||
        "No item-level rights advisory was present in the API response. Review the Library of Congress item page before reuse.",
      url,
    },
    facts: compactObject({
      date: normalizeText(item.date || summary?.date),
      contributors: uniqueStrings([
        ...contentValues(item.contributors),
        ...contentValues(item.creator),
        ...contentValues(summary?.contributor),
      ]),
      createdPublished: uniqueStrings(contentValues(item.created_published)),
      genres: uniqueStrings([
        ...contentValues(item.genre),
        ...contentValues(summary?.genre),
      ]),
      subjects: uniqueStrings([
        ...contentValues(item.subject),
        ...contentValues(summary?.subject),
      ]),
      notes: uniqueStrings(contentValues(item.notes)),
      languages: uniqueStrings([
        ...contentValues(item.language),
        ...contentValues(summary?.language),
      ]),
      collections: uniqueStrings([
        ...contentValues(item.partof_title),
        ...contentValues(summary?.partof),
      ]),
      originalFormats: uniqueStrings(contentValues(summary?.original_format)),
      onlineFormats: uniqueStrings(contentValues(summary?.online_format)),
      locations: uniqueStrings([
        ...contentValues(item.location),
        ...contentValues(summary?.location),
      ]),
      callNumbers: uniqueStrings(contentValues(item.call_number)),
    }),
  };
}

export async function collectLoc({
  limit,
  accessedAt,
  request = createRateLimitedRequester({ minIntervalMs: 6_000 }),
}) {
  const searchUrl = new URL(JUKEBOX_URL);
  searchUrl.searchParams.set("fa", JUKEBOX_FACET);
  searchUrl.searchParams.set("fo", "json");
  searchUrl.searchParams.set("at", "results");
  searchUrl.searchParams.set("dates", "1900/1922");
  searchUrl.searchParams.set("c", String(Math.min(100, Math.max(limit * 2, limit))));

  const search = await request(searchUrl.toString());
  const items = [];
  for (const summary of search?.results ?? []) {
    const itemUrl = canonicalHttpsUrl(summary?.id || summary?.url);
    if (!itemUrl) continue;
    try {
      const detail = await request(itemRequestUrl(itemUrl));
      const item = normalizeLocItem(summary, detail, accessedAt);
      if (item) items.push(item);
      if (items.length >= limit) break;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  return items;
}
