import { normalizeText } from "./normalize.mjs";

export function parseCsv(value) {
  const text = String(value ?? "").replace(/^\uFEFF/u, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(normalizeText(field));
      field = "";
    } else if (character === "\n") {
      row.push(normalizeText(field));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  row.push(normalizeText(field));
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV input ended inside a quoted field");
  if (rows.length === 0) return [];

  const headers = rows[0].map((header, index) => header || `column_${index + 1}`);
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}
