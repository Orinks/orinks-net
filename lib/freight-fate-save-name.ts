/** Match Python's `c.isalnum() || c in " -_"` cloud-slot sanitizer. */
export function freightFateSaveSlotName(profileName: string) {
  const safe = Array.from(profileName, (character) =>
    /[\p{L}\p{N}]/u.test(character) || " -_".includes(character) ? character : "_",
  ).join("").trim();

  return safe || "Driver";
}
