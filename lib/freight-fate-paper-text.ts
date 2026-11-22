// The paper's text helpers that need no wording or catalog data: the name
// marker (see lib/freight-fate-paper.ts) and number formatting. Kept apart so
// the owner's preview page, which runs in the browser, does not load the
// catalogs.

export function formatPaperNumber(value: number) {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const [whole, fraction] = String(Math.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export type PaperTextSegment = { text: string } | { driverId: string; displayName: string };

/** A rendered headline or body as plain runs and named drivers, in order. */
export function paperTextSegments(
  text: string,
  drivers: Array<{ driverId: string; displayName: string }>,
): PaperTextSegment[] {
  const names = new Map(drivers.map((driver) => [driver.driverId, driver.displayName]));
  const segments: PaperTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{@([a-z0-9_-]+)\}/g)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    const displayName = names.get(match[1]);
    segments.push(displayName === undefined ? { text: "" } : { driverId: match[1], displayName });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.filter((segment) => !("text" in segment) || segment.text !== "");
}

/** The same text with each marker replaced by the driver's name. */
export function paperTextPlain(text: string, drivers: Array<{ driverId: string; displayName: string }>) {
  return paperTextSegments(text, drivers)
    .map((segment) => ("text" in segment ? segment.text : segment.displayName))
    .join("");
}
