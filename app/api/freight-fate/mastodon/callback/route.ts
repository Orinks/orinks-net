import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";

export const runtime = "nodejs";

const PAGE = "/freight-fate/online/mastodon";

// The instance sends the player's browser back here after the consent
// screen. Everything meaningful happens in the completeLink action; this
// route only translates the outcome into a result the page can present.
function redirectToPage(request: Request, result: string) {
  const url = new URL(PAGE, request.url);
  url.searchParams.set("result", result);
  const response = NextResponse.redirect(url);
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Mastodon reports a declined consent as error=access_denied. A normal
  // outcome, not a failure: the page says so in a calm voice.
  if (params.get("error")) return redirectToPage(request, "denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return redirectToPage(request, "error");
  const client = getConvexClient();
  if (!client) return redirectToPage(request, "error");
  try {
    const outcome = await client.action(anyApi.freightFateMastodon.completeLink, { state, code }) as
      { ok: true } | { ok: false; reason: string };
    if (outcome.ok) return redirectToPage(request, "linked");
    return redirectToPage(request, outcome.reason === "state_expired" ? "expired" : "error");
  } catch {
    return redirectToPage(request, "error");
  }
}
