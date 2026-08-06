// Canonical driver-naming copy and rejection-reason mapping, shared by every
// page that lets a player name a Freight Fate driver: the setup page, and the
// activation page's inline "create your driver while you connect" step. Two
// hand-written copies of this text would drift; this is the one wording.
//
// The published rules these enforce live at /freight-fate/online/rules.

export const NAME_RULES_HREF = "/freight-fate/online/rules";
export const NAME_RULES_LINK_TEXT = "driver naming rules";

// The field hint, split around the embedded rules link so a caller can wrap
// the middle in an actual <Link>. Concatenated with no separator: the prefix
// ends mid-sentence right before the link text, and the suffix picks up with
// the closing period.
export const NAME_HINT_PREFIX = "3 to 48 characters, including at least three letters. Names must follow the";
export const NAME_HINT_SUFFIX = ". Your driver name is public while Profile sharing is on.";

// kind picks the inline rendering: "blocked" is meant to read alongside a
// link to the rules; every kind renders message verbatim.
export type NameError = { kind: "length" | "letters" | "blocked" | "taken"; message: string };

export const LETTERS_ERROR: NameError = {
  kind: "letters",
  message: "Driver names must include at least three letters. Choose a different name.",
};

export const LENGTH_ERROR: NameError = {
  kind: "length",
  message: "Enter a driver name of 3 to 48 characters.",
};

// Client-side pre-flight for a trimmed driver name: 3-48 characters,
// including at least three \p{L} letters. Mirrors the server's rules
// (provisionDriver / claimActivation) so the common case gets instant
// feedback instead of a round trip. Every page that collects a driver name
// calls this rather than retyping the thresholds -- the wording was
// centralised here for exactly this reason, and two hand-copied predicates
// that read identically today can still drift apart later.
export function validateDriverName(trimmed: string): NameError | null {
  if (trimmed.length < 3 || trimmed.length > 48) {
    return LENGTH_ERROR;
  }
  if ((trimmed.match(/\p{L}/gu) ?? []).length < 3) {
    return LETTERS_ERROR;
  }
  return null;
}

const BLOCKED_MESSAGE_PREFIX = "That name isn't allowed. Choose a different name, or check the ";

export const BLOCKED_ERROR: NameError = {
  kind: "blocked",
  message: `${BLOCKED_MESSAGE_PREFIX}${NAME_RULES_LINK_TEXT}.`,
};

export const TAKEN_ERROR: NameError = {
  kind: "taken",
  message: "That driver name is already taken. Choose a different name.",
};

// Maps the `reason` carried by a name rejection -- provisionDriver throws
// ConvexError({ code: "name_rejected", reason }), claimActivation returns
// { ok: false, code: "name_rejected", reason } -- to the same inline field
// error, regardless of which mutation produced it.
export function nameRejectionForReason(reason: "blocked" | "needs_letters" | undefined): NameError {
  return reason === "needs_letters" ? LETTERS_ERROR : BLOCKED_ERROR;
}
