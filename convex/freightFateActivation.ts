import { ConvexError, v } from "convex/values";

// The alphanumerics minus the pairs a synthesized voice blurs together:
// O/0, I/1/L, S/5, Z/2. What is left is safe to read aloud and to type back.
export const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";
export const ACTIVATION_CODE_LENGTH = 8;
export const ACTIVATION_TTL_MS = 10 * 60_000;

// Codes are short because a player hears them; the ten-minute window and the
// fact that claiming one grants nothing on its own are what keep them safe.
export function mintUserCode() {
  const bytes = new Uint8Array(ACTIVATION_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length];
  }
  return code;
}

export function formatUserCode(raw: string) {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Accepts what a player actually types: any case, with or without the dash,
// with stray spaces. Returns "" for anything that is not a whole code, so a
// caller can treat empty as "not a code" without a second check.
export function normalizeUserCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const stripped = value.toUpperCase().replace(/[\s-]+/g, "");
  if (stripped.length !== ACTIVATION_CODE_LENGTH) {
    return "";
  }
  for (const char of stripped) {
    if (!ACTIVATION_ALPHABET.includes(char)) {
      return "";
    }
  }
  return stripped;
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// The secret the game keeps. Never displayed, never spoken, never logged.
export function mintDeviceCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Same discipline as hashDriverToken in freightFate.ts: only the hash is
// stored, so a database read never yields a usable device code.
export async function hashDeviceCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return toHex(new Uint8Array(digest));
}
