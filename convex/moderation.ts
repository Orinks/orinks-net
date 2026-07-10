import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

// Shared display-name moderation for every public name on the site
// (Freight Fate drivers, Midnight Signal contestants). Two layers:
//
// 1. Write time: screenDisplayName rejects a name before it is stored, so the
//    player gets an inline error and picks something else.
// 2. Display time: maskDisplayName is the safety net for names that were
//    stored before screening existed or that slip past the matcher — they
//    render as an anonymous handle instead of the stored text.
//
// The published rules these enforce live at /freight-fate/online/rules.

// obscenity's English preset handles profanity and slurs, including
// leetspeak, spacing, and repeated-character obfuscation.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

// Hate figures and hate symbols sit outside a profanity dataset's scope, so
// they are matched here after our own leetspeak normalization. Keep this list
// narrow: every root must be unambiguous inside an arbitrary name ("osama",
// for example, is a common given name and must NOT appear here).
const HATE_ROOTS = ["nazi", "hitler", "himmler", "goebbels", "mengele", "klux", "swastika"];

// Symbols and number codes that survive letter-only normalization.
const HATE_RAW = [/1488/, /[卐卍]/u];

function normalizeForModeration(value: string): string {
  return value
    .toLowerCase()
    .replace(/[4@]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

export function isNameBlocked(name: string): boolean {
  if (matcher.hasMatch(name)) {
    return true;
  }
  const normalized = normalizeForModeration(name);
  if (HATE_ROOTS.some((root) => normalized.includes(root))) {
    return true;
  }
  return HATE_RAW.some((pattern) => pattern.test(name));
}

export const MIN_NAME_LETTERS = 3;

export type NameVerdict = { ok: true } | { ok: false; reason: "blocked" | "needs_letters" };

// Write-time screen. The letters rule keeps out all-symbol / all-digit junk
// names; it applies only at write time so short names stored before the rule
// existed keep rendering.
export function screenDisplayName(name: string): NameVerdict {
  const letters = name.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_NAME_LETTERS) {
    return { ok: false, reason: "needs_letters" };
  }
  if (isNameBlocked(name)) {
    return { ok: false, reason: "blocked" };
  }
  return { ok: true };
}

// Display-time safety net: a blocked stored name renders as e.g. "Driver 3f2a"
// so nothing offensive ships to a public page while the row awaits cleanup.
export function maskDisplayName(name: string, idForMask: string, prefix = "Player"): string {
  if (isNameBlocked(name)) {
    return `${prefix} ${idForMask.slice(-4)}`;
  }
  return name;
}
