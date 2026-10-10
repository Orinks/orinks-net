/** Give embedded manual headings the targets used by its Markdown links. */
export function addManualHeadingIds(html: string, markdown: string): string {
  const seen = new Set<string>();
  const ids = [...markdown.matchAll(/^#{2,6}\s+(.+)$/gm)].map((match) => {
    const base = match[1]
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .replace(/ /g, "-");
    let id = base;
    let suffix = 0;
    while (seen.has(id)) id = `${base}-${++suffix}`;
    seen.add(id);
    return id;
  });
  let index = 0;
  return html.replace(/<h([2-6])\b([^>]*)>/g, (heading, level, attributes) => {
    const id = ids[index++];
    if (id === undefined) return heading;
    const rest = attributes.replace(/\s+id=(?:"[^"]*"|'[^']*')/g, "");
    return `<h${level}${rest} id="${id}">`;
  });
}
