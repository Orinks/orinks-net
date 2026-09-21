"use node";

// The daily review digest: one email listing every Freight Fate career
// waiting for review, with an Accept and a Decline link each. Sent only when
// at least one has a marked backup the last digest did not include.
import { gunzipSync } from "node:zlib";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { levelForXp } from "./freightFateProfileProjection";
import { REVIEW_LINK_TTL_MS, signReviewClaim } from "./freightFateReview";

const RESEND_SEND_URL = "https://api.resend.com/emails";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dollars(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value).toLocaleString("en-US")} dollars`
    : "unknown";
}

function day(ms: number) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

// What the reviewer judges: the balance against what the career has ever
// earned, and how far along it is. Read from the latest marked backup.
function careerFacts(content: ArrayBuffer | null) {
  if (!content) return null;
  try {
    const profile = JSON.parse(gunzipSync(Buffer.from(content)).toString("utf8"));
    const career = profile?.career ?? {};
    return {
      money: dollars(profile?.money),
      earnings: dollars(career.total_earnings),
      level: typeof career.xp === "number" ? levelForXp(career.xp) : null,
      deliveries: typeof career.deliveries === "number" ? career.deliveries : null,
      miles: typeof career.total_miles === "number" ? Math.round(career.total_miles) : null,
    };
  } catch {
    return null;
  }
}

type DigestRow = {
  id: Id<"freightFateIntegrityObservations">;
  driverId: string;
  displayName: string;
  saveName: string;
  summary: string | null;
  clientVersion: string | null;
  firstObservedAt: number;
  lastObservedAt: number;
  observations: number;
  isNew: boolean;
  content: ArrayBuffer | null;
};

export const sendReviewDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: boolean; reason?: string; careers?: number }> => {
    const rows: DigestRow[] = await ctx.runQuery(internal.freightFateReview.listReviewDigest, {});
    if (rows.length === 0) return { sent: false, reason: "nothing_new" };
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.CONTACT_FROM_EMAIL;
    const to = process.env.CONTACT_TO_EMAIL;
    const site = process.env.CONVEX_SITE_URL;
    if (!apiKey || !from || !to || !site) {
      console.warn("Freight Fate review digest not sent: email or site URL is not configured.");
      return { sent: false, reason: "not_configured" };
    }
    const now = Date.now();
    const expiresAt = now + REVIEW_LINK_TTL_MS;
    const text: string[] = [];
    const html: string[] = [];
    for (const row of rows) {
      const link = async (decision: "accepted" | "declined") => {
        const token = await signReviewClaim({
          id: row.id, decision, firstObservedAt: row.firstObservedAt, expiresAt,
        });
        return token ? `${site}/freight-fate/review?t=${encodeURIComponent(token)}` : null;
      };
      const accept = await link("accepted");
      const decline = await link("declined");
      if (!accept || !decline) {
        console.warn("Freight Fate review digest not sent: the review secret is not configured.");
        return { sent: false, reason: "not_configured" };
      }
      const facts = careerFacts(row.content);
      const lines = [
        `${row.saveName}, driven by ${row.displayName} (${row.driverId})${row.isNew ? ", new since the last digest" : ""}`,
        facts
          ? `Balance ${facts.money}; lifetime earnings ${facts.earnings}; level ${facts.level ?? "unknown"}; ` +
            `${facts.deliveries ?? "unknown"} deliveries; ${facts.miles ?? "unknown"} miles.`
          : "The latest marked backup could not be read.",
        `${row.observations} marked backup${row.observations === 1 ? "" : "s"}, first ${day(row.firstObservedAt)}, latest ${day(row.lastObservedAt)}, build ${row.clientVersion ?? "unknown"}.`,
      ];
      text.push([...lines, `Accept: ${accept}`, `Decline: ${decline}`].join("\n"));
      html.push(
        `<h2>${escapeHtml(row.saveName)}</h2>` +
        lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
        `<p><a href="${escapeHtml(accept)}">Accept ${escapeHtml(row.saveName)}</a></p>` +
        `<p><a href="${escapeHtml(decline)}">Decline ${escapeHtml(row.saveName)}</a></p>`,
      );
    }
    const intro =
      `${rows.length} Freight Fate career${rows.length === 1 ? " is" : "s are"} waiting for review. ` +
      "Each was marked as changed outside the game, which also happens when a player copies a career " +
      "to another computer. It keeps backing up until you decide. Accept clears its mark; Decline stops " +
      "its backups and hides the driver's public profile. Links open a confirmation page and " +
      "expire in 14 days; the next digest carries fresh ones.";
    const subject = `Freight Fate: ${rows.length} career${rows.length === 1 ? "" : "s"} waiting for review`;
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: [intro, ...text].join("\n\n"),
        html: `<p>${escapeHtml(intro)}</p>${html.join("")}`,
      }),
    });
    if (!response.ok) {
      console.warn(`Freight Fate review digest failed: Resend answered ${response.status}.`);
      return { sent: false, reason: `resend_${response.status}` };
    }
    await ctx.runMutation(internal.freightFateReview.markDigestSent, {
      ids: rows.map((row) => row.id),
      now,
    });
    return { sent: true, careers: rows.length };
  },
});
