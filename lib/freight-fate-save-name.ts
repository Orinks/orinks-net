/** Match Python's `c.isalnum() || c in " -_"` cloud-slot sanitizer. */
export function freightFateSaveSlotName(profileName: string) {
  const safe = Array.from(profileName, (character) =>
    /[\p{L}\p{N}]/u.test(character) || " -_".includes(character) ? character : "_",
  ).join("").trim();

  return safe || "Driver";
}

export function freightFateReleaseSlotName(profileName: string, createdLine: unknown) {
  const name = freightFateSaveSlotName(profileName);
  const match = typeof createdLine === "string" ? /^(\d+)\.(\d+)$/.exec(createdLine) : null;
  if (!match) return name;
  const major = BigInt(match[1]);
  const minor = BigInt(match[2]);
  return major > BigInt(1) || (major === BigInt(1) && minor > BigInt(9))
    ? `${name} (Career ${major})`
    : name;
}

export function splitFreightFateSaveSlotName(slot: string) {
  const match = / \(Career ([1-9][0-9]{0,2})\)$/.exec(slot);
  return match
    ? { base: slot.slice(0, match.index), suffix: match[0] }
    : { base: slot, suffix: "" };
}
