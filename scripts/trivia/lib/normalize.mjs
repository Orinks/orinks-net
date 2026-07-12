const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

const MUSIC_TERMS =
  /\b(?:audio|ballad|blues|chant|choir|choral|composer|concert|dance|dancing|discography|drum|flute|folk song|guitar|hip[ -]?hop|hymn|instrument|jazz|kora|marimba|melod(?:y|ic)|music(?:al|ian|ians)?|opera|orchestra|phonograph|rap|recording|rhythm|sing(?:er|ing)?|song|sound recording|vocal|violin)\b/iu;

export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

function decodeHtmlEntities(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/giu, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const point = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    if (entity.startsWith("#")) {
      const point = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return HTML_ENTITIES.get(entity.toLowerCase()) ?? match;
  });
}

export function stripHtml(value) {
  const withoutBlocks = String(value ?? "").replace(
    /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu,
    " ",
  );
  const withoutTags = withoutBlocks.replace(/<[^>]*>/gu, " ");
  return normalizeText(decodeHtmlEntities(withoutTags));
}

export function canonicalHttpsUrl(value, fallback = "") {
  const candidate = normalizeText(value) || normalizeText(fallback);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values.flat(Infinity)) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function contentValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(contentValues);
  if (typeof value === "object") {
    for (const key of ["content", "name", "title", "label", "value"]) {
      if (value[key] !== undefined) return contentValues(value[key]);
    }
    return [];
  }
  return [normalizeText(value)].filter(Boolean);
}

export function isMusicRelated(values) {
  const searchable = values
    .flat(Infinity)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ")
    .normalize("NFC");
  return MUSIC_TERMS.test(searchable);
}

export function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === null || value === undefined || value === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

export function utcDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Could not determine an access date");
  return date.toISOString().slice(0, 10);
}

export function requireAccessDate(value) {
  const date = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || utcDate(`${date}T00:00:00.000Z`) !== date) {
    throw new Error(`Invalid accessedAt date: ${value}`);
  }
  return date;
}

export function truncateText(value, maxLength = 800) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
