import { NextResponse } from "next/server";
import { formatContactEmail, validateContactSubmission } from "@/lib/contact";

export const runtime = "nodejs";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_SEND_URL = "https://api.resend.com/emails";

/**
 * Cloudflare rejects a token that was already spent or that aged out (they
 * live 300 seconds). Neither is the sender's fault, so they get "try again"
 * rather than "you failed a robot test" — the widget resets and the typed
 * message is still sitting in the form.
 */
const RETRYABLE_TURNSTILE_CODES = new Set(["timeout-or-duplicate", "invalid-input-response"]);

type TurnstileResult = { success: boolean; "error-codes"?: string[] };

async function verifyTurnstile(token: string, remoteIp: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return { ok: false as const, configured: false as const, retryable: false };
  }

  const body = new URLSearchParams({ response: token, secret });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    body,
    method: "POST",
  });

  if (!response.ok) {
    // Cloudflare itself is unhappy; treat it as retryable rather than
    // accusing the sender of being a bot.
    return { ok: false as const, configured: true as const, retryable: true };
  }

  const result = (await response.json()) as TurnstileResult;
  const codes = result["error-codes"] ?? [];

  return {
    ok: result.success === true,
    configured: true as const,
    retryable: codes.some((code) => RETRYABLE_TURNSTILE_CODES.has(code)),
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  const { values, errors } = validateContactSubmission(body);

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "Some details need fixing before this can send.", fieldErrors: errors },
      { status: 400 },
    );
  }

  const token = (body as { turnstileToken?: unknown }).turnstileToken;

  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { captcha: true, error: "Confirm you are human, then send again." },
      { status: 400 },
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const remoteIp = forwardedFor?.split(",")[0]?.trim() || null;
  const verification = await verifyTurnstile(token, remoteIp);

  if (!verification.configured) {
    return NextResponse.json(
      { error: "The contact form is not configured yet. Please email orin8722@gmail.com instead." },
      { status: 503 },
    );
  }

  if (!verification.ok) {
    return NextResponse.json(
      {
        captcha: true,
        error: verification.retryable
          ? "That human check expired. Confirm you are human again, then send."
          : "That human check could not be confirmed. Please try again.",
      },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;

  if (!apiKey || !from || !to) {
    return NextResponse.json(
      { error: "The contact form is not configured yet. Please email orin8722@gmail.com instead." },
      { status: 503 },
    );
  }

  const mail = formatContactEmail(values);

  let response: Response;

  try {
    response = await fetch(RESEND_SEND_URL, {
      body: JSON.stringify({
        from,
        html: mail.html,
        // The sender never appears in From — that address has to stay on the
        // verified sending domain or the mail reads as spoofed and lands in
        // spam. Reply-To is what makes "reply" go to the right person.
        reply_to: `${values.name} <${values.email}>`,
        subject: mail.subject,
        text: mail.text,
        to: [to],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return NextResponse.json(
      { error: "Your message could not be sent just now. Please try again in a moment." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    console.error(
      `Contact form: Resend rejected the send with ${response.status}: ${await response.text()}`,
    );

    return NextResponse.json(
      { error: "Your message could not be sent just now. Please try again in a moment." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
