// The owner's review of Freight Fate careers marked as changed outside the
// game. A marked career keeps backing up while it waits
// (freightFateSaves.recordIntegrityObservation); the daily digest
// (freightFateReviewDigest.ts) emails one Accept and one Decline link per
// career waiting, and the pages here
// answer those links. Links carry a signed, expiring token, and a link only
// opens a page: the decision is a separate POST from that page, so a mail
// scanner that follows every link in an email can never decide anything.
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const REVIEW_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type ReviewDecision = "accepted" | "declined";

type ReviewClaim = {
  id: Id<"freightFateIntegrityObservations">;
  decision: ReviewDecision;
  firstObservedAt: number;
  expiresAt: number;
};

function reviewSecret() {
  const secret = process.env.FREIGHT_FATE_REVIEW_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A signed link token, or null when the review secret is not configured. */
export async function signReviewClaim(claim: ReviewClaim) {
  const secret = reviewSecret();
  if (!secret) return null;
  const body = [claim.id, claim.decision, claim.firstObservedAt, claim.expiresAt].join(".");
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyReviewClaim(token: string, now: number): Promise<ReviewClaim | null> {
  const secret = reviewSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [id, decision, first, expires, mac] = parts;
  const body = [id, decision, first, expires].join(".");
  if (!sameText(mac, await hmacHex(secret, body))) return null;
  if (decision !== "accepted" && decision !== "declined") return null;
  const firstObservedAt = Number(first);
  const expiresAt = Number(expires);
  if (!Number.isFinite(firstObservedAt) || !Number.isFinite(expiresAt) || expiresAt < now) {
    return null;
  }
  return {
    id: id as Id<"freightFateIntegrityObservations">,
    decision,
    firstObservedAt,
    expiresAt,
  };
}

// Careers waiting for review that the digest should list. Empty unless at least one has a
// marked backup the last digest did not include -- a day with nothing new
// sends no email, even while older reviews still wait.
export const listReviewDigest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = [
      ...(await ctx.db
        .query("freightFateIntegrityObservations")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect()),
      // Rows written before review existed carry no status and read as pending.
      ...(await ctx.db
        .query("freightFateIntegrityObservations")
        .withIndex("by_status", (q) => q.eq("status", undefined))
        .collect()),
    ];
    const anyNew = pending.some((row) =>
      row.notifiedAt === undefined || row.lastObservedAt > row.notifiedAt);
    if (!anyNew) return [];
    const rows = [];
    for (const row of pending) {
      const driver = await ctx.db
        .query("freightFateDrivers")
        .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId))
        .first();
      rows.push({
        id: row._id,
        driverId: row.driverId,
        displayName: driver?.displayName ?? row.driverId,
        saveName: row.saveName,
        summary: row.summary ?? null,
        clientVersion: row.clientVersion ?? null,
        firstObservedAt: row.firstObservedAt,
        lastObservedAt: row.lastObservedAt,
        observations: row.observations,
        isNew: row.notifiedAt === undefined || row.lastObservedAt > row.notifiedAt,
        content: row.content ?? null,
      });
    }
    return rows.sort((a, b) => b.lastObservedAt - a.lastObservedAt);
  },
});

export const markDigestSent = internalMutation({
  args: { ids: v.array(v.id("freightFateIntegrityObservations")), now: v.number() },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      if (await ctx.db.get(id)) await ctx.db.patch(id, { notifiedAt: args.now });
    }
  },
});

type ReviewRow = {
  displayName: string;
  driverId: string;
  saveName: string;
  summary: string | null;
  observations: number;
  status: string;
  firstObservedAt: number;
};

export const getReviewRow = internalQuery({
  args: { id: v.id("freightFateIntegrityObservations") },
  handler: async (ctx, args): Promise<ReviewRow | null> => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId))
      .first();
    return {
      displayName: driver?.displayName ?? row.driverId,
      driverId: row.driverId,
      saveName: row.saveName,
      summary: row.summary ?? null,
      observations: row.observations,
      status: row.status ?? "pending",
      firstObservedAt: row.firstObservedAt,
    };
  },
});

// -- pages -------------------------------------------------------------------

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1a1a1a; --bg: #ffffff; --accent: #0b57d0; }
@media (prefers-color-scheme: dark) { :root { --fg: #f1f1f1; --bg: #161616; --accent: #8ab4f8; } }
body { font: 1.125rem/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg);
  max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem; }
dt { font-weight: 600; margin-top: 0.75rem; }
dd { margin: 0; }
button { font: inherit; padding: 0.75rem 1.25rem; margin-top: 1.5rem; border: 2px solid var(--accent);
  border-radius: 0.5rem; background: var(--accent); color: var(--bg); cursor: pointer; }
button:focus-visible { outline: 3px solid var(--fg); outline-offset: 3px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}

const VERB: Record<ReviewDecision, string> = { accepted: "Accept", declined: "Decline" };

const unusable = () =>
  page(
    "This review link does not work",
    "<p>It has expired, or it was changed. The next digest email carries fresh links for every career still waiting.</p>",
    400,
  );

export const reviewPage = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const claim = await verifyReviewClaim(token, Date.now());
  if (!claim) return unusable();
  const row: ReviewRow | null = await ctx.runQuery(internal.freightFateReview.getReviewRow, {
    id: claim.id,
  });
  if (!row) return page("This career is no longer waiting", "<p>Its review was cleared.</p>", 404);
  if (row.status !== "pending" || row.firstObservedAt !== claim.firstObservedAt) {
    return page(
      "Already decided",
      `<p>${escapeHtml(row.saveName)} by ${escapeHtml(row.displayName)} is no longer waiting for this review.</p>`,
    );
  }
  const verb = VERB[claim.decision];
  const effect = claim.decision === "accepted"
    ? "The game clears its mark at its next backup."
    : "It stops backing up, and the driver's public profile is hidden.";
  return page(
    `${verb} ${row.saveName}?`,
    `<dl>
<dt>Driver</dt><dd>${escapeHtml(row.displayName)} (${escapeHtml(row.driverId)})</dd>
<dt>Career</dt><dd>${escapeHtml(row.saveName)}</dd>
${row.summary ? `<dt>Latest backup</dt><dd>${escapeHtml(row.summary)}</dd>` : ""}
<dt>Marked backups</dt><dd>${row.observations}</dd>
</dl>
<p>${effect}</p>
<form method="post">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<button type="submit">${verb} this career</button>
</form>`,
  );
});

export const decideFromPage = httpAction(async (ctx, request) => {
  const form = await request.formData().catch(() => null);
  const token = typeof form?.get("t") === "string" ? (form.get("t") as string) : "";
  const claim = await verifyReviewClaim(token, Date.now());
  if (!claim) return unusable();
  const result: { ok: boolean; saveName?: string } = await ctx.runMutation(
    internal.freightFateSaves.decideIntegrityReview,
    {
      id: claim.id,
      decision: claim.decision,
      firstObservedAt: claim.firstObservedAt,
    },
  );
  if (!result.ok) {
    return page("Already decided", "<p>This career is no longer waiting for this review.</p>");
  }
  const done = claim.decision === "accepted" ? "Accepted" : "Declined";
  const next = claim.decision === "accepted"
    ? "The game clears its mark at its next backup."
    : "It no longer backs up, and the driver's public profile is hidden.";
  return page(`${done}: ${result.saveName ?? "career"}`, `<p>${next}</p>`);
});
