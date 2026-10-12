// Cloudflare Turnstile, the human check on the forms anyone can send without
// signing in. The secret lives only in this deployment's environment: the
// station form checks here directly, and the contact form's route asks
// verifyHumanCheck, so the site never holds a copy of its own.

import { v } from "convex/values";
import { action } from "./_generated/server";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The secret as this deployment holds it. A copy out of a `vercel env pull`
 * file can carry the quotes and a written-out "\n" along with the value, and a
 * Sensitive Vercel variable pulls as the placeholder "[SENSITIVE]", which is
 * no secret at all. Either way Cloudflare refuses every visitor, which looks
 * like a failed check.
 */
export function turnstileSecret(raw: string | undefined) {
  const secret = (raw ?? "").trim().replace(/^"|"$/g, "").replace(/(\\n)+$/, "").trim();
  return /^\[.*\]$/.test(secret) ? "" : secret;
}

/**
 * "unconfigured": no usable secret here, or Cloudflare rejected it, which is
 * the site's fault and not the visitor's. "retry": the token expired or was
 * already spent, so the visitor only needs to tick again.
 */
export type HumanCheck = { result: "passed" | "failed" | "retry" | "unconfigured" };

// Cloudflare refuses a token that was already spent or that aged out (they
// live 300 seconds). Neither is the sender's fault.
const RETRYABLE_CODES = new Set(["timeout-or-duplicate", "invalid-input-response"]);

/** Cloudflare's answer on a visitor's token. */
export async function humanCheck(token: string, remoteIp?: string): Promise<HumanCheck> {
  const secret = turnstileSecret(process.env.TURNSTILE_SECRET_KEY);
  if (!secret) return { result: "unconfigured" };
  if (!token) return { result: "failed" };
  const body = new URLSearchParams({ response: token, secret });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    // A refusal can come back as HTTP 400 with the reason in the body, so the
    // body is read whatever the status.
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; "error-codes"?: string[] };
    if (response.ok && result.success === true) return { result: "passed" };
    const codes = result["error-codes"] ?? [];
    console.warn(`Turnstile refused the check (HTTP ${response.status}): ${codes.join(", ") || "no code given"}`);
    if (codes.some((code) => code.includes("secret"))) return { result: "unconfigured" };
    if (codes.some((code) => RETRYABLE_CODES.has(code))) return { result: "retry" };
    // Cloudflare itself is unhappy; worth another try rather than calling the
    // sender a bot.
    return { result: response.status >= 500 ? "retry" : "failed" };
  } catch (error) {
    console.error("Turnstile siteverify could not be reached", error);
    return { result: "retry" };
  }
}

/**
 * The contact form's check. Public on purpose: all it can do is spend a token
 * the caller already holds, and the answer says nothing about the secret.
 */
export const verifyHumanCheck = action({
  args: { token: v.string(), remoteIp: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<HumanCheck> => humanCheck(args.token, args.remoteIp),
});
