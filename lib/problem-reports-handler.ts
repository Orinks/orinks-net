import { resolveMx } from "node:dns/promises";
import { gunzipSync } from "node:zlib";
import { anyApi } from "convex/server";
import { clientIp } from "@/lib/client-ip";
import { getConvexClient } from "@/lib/convex";
import { gamesServerSecret } from "@/lib/games/stores";
import {
  composeEmail,
  isBlocked,
  MAX_BODY_BYTES,
  parseBlockList,
  parseReport,
  PER_ADDRESS_PER_DAY,
  PER_DAY,
  takesApp,
  type ProblemReport,
} from "@/lib/problem-reports";

// Problem reports from Hearken games (hearken-report; the format is
// mailbag's). The game posts what the player wrote and its logs here, and
// this emails them through Resend to the address the contact form uses.
// The game never holds a mail password, and this never emails anyone else:
// the player's address rides on Reply-To. Answers are mailbag's: 202 sent,
// 400 malformed, 403 not a game we take or a blocked address, 413 too big,
// 422 the reply address's domain takes no mail, 429 over a limit, 502 the
// email did not go out.

const RESEND_SEND_URL = "https://api.resend.com/emails";
const DAY_MS = 24 * 60 * 60_000;

export type Deps = {
  /** Whether `key` may take one more report today, under `limit` a day. */
  allow(key: string, limit: number): Promise<boolean>;
  /** Whether `domain` has mail exchangers; null when the lookup itself failed. */
  takesMail(domain: string): Promise<boolean | null>;
  sendMail(body: Record<string, unknown>): Promise<Response>;
};

/**
 * The day's counters live on Convex when the games secret is set, so every
 * instance of this function shares them. Without it each instance counts
 * on its own, which still bounds a burst from one address.
 */
function convexOrMemoryLimiter(): Deps["allow"] {
  const client = getConvexClient();
  const secret = gamesServerSecret();
  const memory = new Map<string, { windowStart: number; count: number }>();
  return async (key, limit) => {
    const now = Date.now();
    if (client && secret) {
      try {
        return (await client.mutation(anyApi.games.consumeRateLimit, {
          secret,
          key: `problem-reports:${key}`,
          limit,
          now,
          windowMs: DAY_MS,
        })) as boolean;
      } catch (error) {
        console.error("Problem reports: the rate limit could not be checked", error);
      }
    }
    const windowStart = now - (now % DAY_MS);
    const row = memory.get(key);
    if (!row || row.windowStart !== windowStart) {
      memory.set(key, { windowStart, count: 1 });
      return true;
    }
    if (row.count >= limit) return false;
    row.count += 1;
    return true;
  };
}

async function mxTakesMail(domain: string): Promise<boolean | null> {
  try {
    const records = await resolveMx(domain);
    return records.some((r) => r.exchange && r.exchange !== ".");
  } catch (error) {
    const code = (error as { code?: string }).code;
    // No such domain, or a domain with no MX: nothing will deliver there.
    if (code === "ENOTFOUND" || code === "ENODATA") return false;
    return null;
  }
}

export const liveDeps: Deps = {
  allow: convexOrMemoryLimiter(),
  takesMail: mxTakesMail,
  sendMail: (body) =>
    fetch(RESEND_SEND_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
};

function refuse(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** The report's JSON, unpacked when the game gzipped it, within the size cap. */
async function readBody(request: Request): Promise<{ body: unknown } | { status: 400 | 413; error: string }> {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return { status: 413, error: "the report is too big" };
  let bytes: Uint8Array = raw;
  if ((request.headers.get("content-encoding") ?? "").toLowerCase() === "gzip") {
    try {
      bytes = gunzipSync(raw, { maxOutputLength: MAX_BODY_BYTES });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ERR_BUFFER_TOO_LARGE") return { status: 413, error: "the report is too big" };
      return { status: 400, error: "the report could not be unpacked" };
    }
  }
  try {
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { status: 400, error: "the report is not JSON" };
  }
}

export function createHandler(deps: Deps) {
  return async function POST(request: Request) {
    const ip = clientIp(request);
    if (isBlocked(ip, parseBlockList(process.env.PROBLEM_REPORT_BLOCK))) {
      return refuse(403, "reports from this address are not taken");
    }
    const read = await readBody(request);
    if (!("body" in read)) return refuse(read.status, read.error);
    const parsed = parseReport(read.body);
    if (!parsed.ok) return refuse(parsed.status, parsed.error);
    const report: ProblemReport = parsed.report;
    if (!takesApp(report.app)) return refuse(403, `reports from ${report.app} are not taken`);

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.PROBLEM_REPORT_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL;
    const to = process.env.PROBLEM_REPORT_TO_EMAIL || process.env.CONTACT_TO_EMAIL;
    if (!apiKey || !from || !to) return refuse(503, "problem reports are not set up on this server");

    // Blocked and malformed reports never count toward the limits.
    if (!(await deps.allow(`address:${ip ?? "unknown"}`, PER_ADDRESS_PER_DAY))) {
      return refuse(429, "too many reports from this address today");
    }
    if (!(await deps.allow("all", PER_DAY))) return refuse(429, "too many reports today");

    if (report.reply_to) {
      const domain = report.reply_to.slice(report.reply_to.lastIndexOf("@") + 1);
      // A lookup that fails is not the player's fault; the report is taken.
      if ((await deps.takesMail(domain)) === false) {
        return refuse(422, "the reply address's domain does not take email");
      }
    }

    const mail = composeEmail(report);
    let response: Response;
    try {
      response = await deps.sendMail({
        from,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.reply_to ? { reply_to: mail.reply_to } : {}),
        ...(mail.attachments.length ? { attachments: mail.attachments } : {}),
      });
    } catch {
      return refuse(502, "the report could not be emailed");
    }
    if (!response.ok) {
      console.error(`Problem reports: Resend rejected the send with ${response.status}: ${await response.text()}`);
      return refuse(502, "the report could not be emailed");
    }
    return new Response(null, { status: 202 });
  };
}

