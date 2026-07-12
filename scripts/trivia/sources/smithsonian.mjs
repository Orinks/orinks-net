import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import {
  canonicalHttpsUrl,
  compactObject,
  contentValues,
  isMusicRelated,
  normalizeText,
  requireAccessDate,
  truncateText,
  uniqueStrings,
} from "../lib/normalize.mjs";
import { createRateLimitedRequester } from "../lib/request.mjs";

const API_URL = "https://api.si.edu/openaccess/api/v1.0/search";
const RIGHTS_URL = "https://www.si.edu/openaccess/faq";
const MAX_WHOLE_JSON_BYTES = 64 * 1024 * 1024;

function inputPath(input) {
  if (input instanceof URL) {
    if (input.protocol !== "file:") throw new Error("--input must be a local file path");
    return fileURLToPath(input);
  }
  return path.resolve(String(input));
}

function recordsFromContainer(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.response?.rows)) return value.response.rows;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return value && typeof value === "object" ? [value] : [];
}

async function parseWholeJson(file, size) {
  if (size > MAX_WHOLE_JSON_BYTES) {
    throw new Error(
      `The supplied JSON is ${Math.ceil(size / 1024 / 1024)} MB and is not line-delimited. ` +
        "Use a decompressed Smithsonian line-delimited JSON unit file to keep memory bounded.",
    );
  }
  return JSON.parse(await readFile(file, "utf8"));
}

export async function* readSmithsonianBulk(input) {
  const file = inputPath(input);
  if (/\.bz2$/iu.test(file)) {
    throw new Error(
      "Smithsonian .bz2 archives must be decompressed first; pass the resulting JSON/JSONL/TXT file with --input.",
    );
  }
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`Smithsonian input is not a file: ${file}`);

  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let firstLine;
  while (firstLine === undefined) {
    const entry = await iterator.next();
    if (entry.done) break;
    if (entry.value.trim()) firstLine = entry.value.replace(/^\uFEFF/u, "");
  }
  if (firstLine === undefined) {
    lines.close();
    return;
  }

  let firstValue;
  try {
    firstValue = JSON.parse(firstLine);
  } catch {
    lines.close();
    stream.destroy();
    const whole = await parseWholeJson(file, info.size);
    for (const record of recordsFromContainer(whole)) yield record;
    return;
  }

  for (const record of recordsFromContainer(firstValue)) yield record;
  for await (const line of iterator) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid line-delimited JSON in ${file}: ${error.message}`);
    }
    for (const record of recordsFromContainer(value)) yield record;
  }
}

function freeTextValues(freetext, key) {
  return contentValues(freetext?.[key]);
}

function smithsonianSearchValues(record) {
  const content = record?.content ?? {};
  const indexed = content.indexedStructured ?? {};
  const freetext = content.freetext ?? {};
  return [
    record?.title,
    content?.title,
    indexed?.topic,
    indexed?.object_type,
    indexed?.name,
    freetext?.title,
    freetext?.notes,
    freetext?.objectType,
    freetext?.topic,
    freetext?.name,
  ];
}

export function normalizeSmithsonianRecord(record, accessedAt) {
  const content = record?.content ?? {};
  const descriptive = content.descriptiveNonRepeating ?? {};
  const indexed = content.indexedStructured ?? {};
  const freetext = content.freetext ?? {};
  const sourceId = normalizeText(
    descriptive.record_ID || content.record_id || content.id || record?.id,
  );
  const title = normalizeText(record?.title || content.title || descriptive.title?.content);
  const containedIn = Array.isArray(content.containedIn) ? content.containedIn : [];
  const url = canonicalHttpsUrl(
    descriptive.record_link ||
      content.guid ||
      containedIn.at(-1)?.url ||
      record?.url,
  );
  if (!sourceId || !title || !url) return null;

  const metadataAccess = normalizeText(
    descriptive.metadata_usage?.access || content.metadata_usage?.access,
  );
  const useRestrictions = uniqueStrings([
    ...freeTextValues(freetext, "userestrict"),
    ...freeTextValues(freetext, "accessrestrict"),
  ]).map((value) => truncateText(value, 600));
  const metadataCc0 = metadataAccess.toUpperCase() === "CC0";
  const rightsLead = metadataCc0
    ? "Record metadata is designated CC0; object and media rights may differ."
    : "The record does not identify its metadata as CC0; verify all rights before reuse.";

  return {
    source: "smithsonian",
    sourceId,
    publisher: "Smithsonian Institution",
    title,
    url,
    accessedAt: requireAccessDate(accessedAt),
    rights: {
      status: metadataCc0 ? "metadata-cc0" : "unknown",
      statement: [rightsLead, ...useRestrictions].join(" "),
      url: RIGHTS_URL,
    },
    facts: compactObject({
      recordId: sourceId,
      unitCode: normalizeText(record.unitCode),
      dataSource: normalizeText(
        descriptive.data_source || freeTextValues(freetext, "dataSource")[0],
      ),
      objectTypes: uniqueStrings([
        ...contentValues(indexed.object_type),
        ...freeTextValues(freetext, "objectType"),
      ]),
      dates: uniqueStrings([
        ...contentValues(indexed.date),
        ...freeTextValues(freetext, "date"),
      ]),
      names: uniqueStrings([
        ...contentValues(indexed.name),
        ...freeTextValues(freetext, "name"),
      ]),
      places: uniqueStrings([
        ...contentValues(indexed.place),
        ...freeTextValues(freetext, "place"),
      ]),
      topics: uniqueStrings([
        ...contentValues(indexed.topic),
        ...freeTextValues(freetext, "topic"),
      ]),
      notes: uniqueStrings(freeTextValues(freetext, "notes")).map((value) =>
        truncateText(value),
      ),
      creditLines: uniqueStrings(freeTextValues(freetext, "creditLine")),
      useRestrictions,
      onlineMediaTypes: uniqueStrings(contentValues(indexed.online_media_type)),
    }),
  };
}

export async function collectSmithsonian({
  input,
  apiKey,
  limit,
  accessedAt,
  request = createRateLimitedRequester({ minIntervalMs: 250 }),
}) {
  const items = [];
  if (input) {
    for await (const record of readSmithsonianBulk(input)) {
      if (!isMusicRelated(smithsonianSearchValues(record))) continue;
      const item = normalizeSmithsonianRecord(record, accessedAt);
      if (item) items.push(item);
      if (items.length >= limit) break;
    }
    return items;
  }

  if (!apiKey) {
    throw new Error(
      "Smithsonian collection requires either --input <decompressed bulk JSON/JSONL file> or a SMITHSONIAN_API_KEY environment variable.",
    );
  }
  const url = new URL(API_URL);
  url.searchParams.set("q", "music");
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("start", "0");
  url.searchParams.set("sort", "relevancy");
  url.searchParams.set("api_key", apiKey);
  const response = await request(url.toString());
  for (const record of recordsFromContainer(response)) {
    if (!isMusicRelated(smithsonianSearchValues(record))) continue;
    const item = normalizeSmithsonianRecord(record, accessedAt);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
