/**
 * An HLS playlist with each segment, variant and URI="..." made absolute
 * against where it came from, then passed through wrap (the preview route,
 * so Safari's own HLS player fetches through the site too).
 */
export function absolutePlaylist(text: string, base: URL, wrap: (address: string) => string = (address) => address) {
  const absolute = (address: string) => {
    try {
      return wrap(new URL(address, base).href);
    } catch {
      return address;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const entry = line.trim();
      if (!entry) return line;
      if (!entry.startsWith("#")) return absolute(entry);
      return line.replace(/URI="([^"]*)"/g, (_, address: string) => `URI="${absolute(address)}"`);
    })
    .join("\n");
}
