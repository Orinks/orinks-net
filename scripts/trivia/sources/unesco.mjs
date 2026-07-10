import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../lib/csv.mjs";
import {
  canonicalHttpsUrl,
  compactObject,
  isMusicRelated,
  normalizeText,
  requireAccessDate,
  stripHtml,
  uniqueStrings,
} from "../lib/normalize.mjs";
import { createRateLimitedRequester } from "../lib/request.mjs";

const DIVE_DATA_URL = "https://ich.unesco.org/dive/data/graph_en.json";
const DIVE_OPEN_DATA_PAGE = "https://ich.unesco.org/en/open-access-to-dive-data-01218";

function relatedNodes(graph, nodeId) {
  const related = [];
  for (const edge of graph?.edges ?? []) {
    const otherId = edge.subject === nodeId
      ? edge.object
      : edge.object === nodeId
        ? edge.subject
        : null;
    if (otherId && graph.nodes?.[otherId]) related.push(graph.nodes[otherId]);
  }
  return related;
}

function unescoRights() {
  return {
    status: "official-open-data",
    statement:
      "UNESCO publishes the DIVE graph as open data. Rights for linked images, video, and other media remain item-specific and are not granted by this metadata record.",
    url: DIVE_OPEN_DATA_PAGE,
  };
}

function normalizeGraphElement(nodeId, node, related, graph, accessedAt) {
  const title = normalizeText(node?.label);
  const description = stripHtml(node?.meta?.description);
  const concepts = uniqueStrings(
    related.filter((entry) => entry.type === "concept").map((entry) => entry.label),
  );
  if (!isMusicRelated([title, description, concepts])) return null;
  const sourceId = normalizeText(nodeId);
  const url = canonicalHttpsUrl(
    node?.meta?.link,
    `https://ich.unesco.org/dive/constellation/?language=en&focus=${encodeURIComponent(sourceId)}`,
  );
  if (!sourceId || !title || !url) return null;

  return {
    source: "unesco",
    sourceId,
    publisher: "UNESCO Intangible Cultural Heritage",
    title,
    url,
    accessedAt: requireAccessDate(accessedAt),
    rights: unescoRights(),
    facts: compactObject({
      description,
      list: normalizeText(node?.meta?.list),
      inscriptionYear: Number.isInteger(node?.meta?.year) ? node.meta.year : undefined,
      multinational:
        typeof node?.meta?.multinational === "boolean" ? node.meta.multinational : undefined,
      concepts,
      countries: uniqueStrings(
        related.filter((entry) => entry.type === "country").map((entry) => entry.label),
      ),
      regions: uniqueStrings(
        related.filter((entry) => entry.type === "region").map((entry) => entry.label),
      ),
      datasetLanguage: normalizeText(graph?.meta?.language),
      datasetGeneratedAt: normalizeText(graph?.meta?.generated),
    }),
  };
}

export function normalizeUnescoGraph(graph, { limit, accessedAt }) {
  if (!graph?.nodes || typeof graph.nodes !== "object" || !Array.isArray(graph.edges)) {
    throw new Error("UNESCO JSON input is not a DIVE graph with nodes and edges");
  }
  const items = [];
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node?.type !== "element") continue;
    const item = normalizeGraphElement(
      nodeId,
      node,
      relatedNodes(graph, nodeId),
      graph,
      accessedAt,
    );
    if (item) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function keyOf(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function keyedRow(row) {
  return new Map(Object.entries(row).map(([key, value]) => [keyOf(key), value]));
}

function rowValue(row, ...names) {
  for (const name of names) {
    const value = row.get(keyOf(name));
    if (normalizeText(value)) return value;
  }
  return "";
}

function splitValues(value) {
  return uniqueStrings(normalizeText(value).split(/[|;]/u));
}

function parseBoolean(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return undefined;
}

export function normalizeUnescoCsv(text, { limit, accessedAt }) {
  const items = [];
  for (const sourceRow of parseCsv(text)) {
    const row = keyedRow(sourceRow);
    const type = normalizeText(rowValue(row, "type", "node type"));
    if (type && type.toLowerCase() !== "element") continue;
    const sourceId = normalizeText(
      rowValue(row, "id", "node id", "element id", "identifier"),
    );
    const title = normalizeText(rowValue(row, "label", "title", "name", "element"));
    const description = stripHtml(rowValue(row, "description", "summary"));
    const concepts = splitValues(rowValue(row, "concepts", "concept"));
    if (!sourceId || !title || !isMusicRelated([title, description, concepts])) continue;
    const url = canonicalHttpsUrl(
      rowValue(row, "link", "url", "canonical url"),
      `https://ich.unesco.org/dive/constellation/?language=en&focus=${encodeURIComponent(sourceId)}`,
    );
    const year = Number(rowValue(row, "year", "inscription year"));
    items.push({
      source: "unesco",
      sourceId,
      publisher: "UNESCO Intangible Cultural Heritage",
      title,
      url,
      accessedAt: requireAccessDate(accessedAt),
      rights: unescoRights(),
      facts: compactObject({
        description,
        list: normalizeText(rowValue(row, "list")),
        inscriptionYear: Number.isInteger(year) && year > 0 ? year : undefined,
        multinational: parseBoolean(rowValue(row, "multinational")),
        concepts,
        countries: splitValues(rowValue(row, "countries", "country")),
        regions: splitValues(rowValue(row, "regions", "region")),
      }),
    });
    if (items.length >= limit) break;
  }
  return items;
}

function filePath(input) {
  if (input instanceof URL) {
    if (input.protocol !== "file:") throw new Error("--input must be a local file path");
    return fileURLToPath(input);
  }
  return path.resolve(String(input));
}

function isWafResponse(error) {
  const text = `${error?.message ?? ""} ${error?.bodySnippet ?? ""}`;
  return (
    [401, 403, 406, 429, 503].includes(error?.status) ||
    /captcha|cloudflare|attention required|access denied|web application firewall|\bwaf\b/iu.test(
      text,
    )
  );
}

function browserDownloadError(error) {
  const status = error?.status ? ` (HTTP ${error.status})` : "";
  return new Error(
    `UNESCO DIVE blocked this download${status}. ` +
      `Open the UNESCO DIVE open-data page in a browser: ${DIVE_OPEN_DATA_PAGE}. ` +
      "Download the English JSON file or Constellation CSV file. Then run this command " +
      "again with --source unesco --input <downloaded-file>.",
    { cause: error },
  );
}

export async function collectUnesco({
  input,
  limit,
  accessedAt,
  request = createRateLimitedRequester({ minIntervalMs: 500, timeoutMs: 30_000 }),
}) {
  if (input) {
    const file = filePath(input);
    const text = await readFile(file, "utf8");
    const first = text.replace(/^\uFEFF/u, "").trimStart()[0];
    if (first === "{" || first === "[") {
      return normalizeUnescoGraph(JSON.parse(text), { limit, accessedAt });
    }
    return normalizeUnescoCsv(text, { limit, accessedAt });
  }

  let graph;
  try {
    graph = await request(DIVE_DATA_URL);
  } catch (error) {
    if (isWafResponse(error)) throw browserDownloadError(error);
    throw error;
  }
  return normalizeUnescoGraph(graph, { limit, accessedAt });
}
