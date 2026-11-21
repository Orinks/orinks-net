/** Match Python's `c.isalnum() || c in " -_"` cloud-slot sanitizer. */
export function freightFateSaveSlotName(profileName: string) {
  const safe = Array.from(profileName, (character) =>
    /[\p{L}\p{N}]/u.test(character) || " -_".includes(character) ? character : "_",
  ).join("").trim();

  return safe || "Driver";
}

/** True for a save created on a release line after 1.9 ("2.0", "1.10", ...). */
export function isPostStableLine(createdLine: unknown) {
  const match = typeof createdLine === "string" ? /^(\d+)\.(\d+)$/.exec(createdLine) : null;
  if (!match) return false;
  const major = BigInt(match[1]);
  const minor = BigInt(match[2]);
  return major > BigInt(1) || (major === BigInt(1) && minor > BigInt(9));
}

export function freightFateReleaseSlotName(profileName: string, createdLine: unknown) {
  const name = freightFateSaveSlotName(profileName);
  if (!isPostStableLine(createdLine)) return name;
  const major = BigInt((createdLine as string).split(".")[0]);
  return `${name} (Career ${major})`;
}

export function splitFreightFateSaveSlotName(slot: string) {
  const match = / \(Career ([1-9][0-9]{0,2})\)$/.exec(slot);
  return match
    ? { base: slot.slice(0, match.index), suffix: match[0] }
    : { base: slot, suffix: "" };
}
