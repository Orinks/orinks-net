import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import type { HumanCheck } from "@/convex/turnstile";
import { getConvexClient } from "@/lib/convex";
import { formatContactEmail, validateContactSubmission } from "@/lib/contact";

export const runtime = "nodejs";

const RESEND_SEND_URL = "https://api.resend.com/emails";

/**
 * The human check runs on Convex, which holds the Turnstile secret for both
 * this form and the station form, so the key lives in one place.
 */
async function verifyTurnstile(token: string, remoteIp: string | null) {
  const client = getConvexClient();

  if (!client) {
    return { result: "unconfigured" as const };
  }

  try {
    return (await client.action(anyApi.turnstile.verifyHumanCheck, {
      token,
      ...(remoteIp ? { remoteIp } : {}),
    })) as HumanCheck;
  } catch {
    // Convex unreachable: a retry, not an accusation.
    return { result: "retry" as const };
  }
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

  if (verification.result === "unconfigured") {
    return NextResponse.json(
      { error: "The contact form is not configured yet. Please email orin8722@gmail.com instead." },
      { status: 503 },
    );
  }

  if (verification.result !== "passed") {
    return NextResponse.json(
      {
        captcha: true,
        error: verification.result === "retry"
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
