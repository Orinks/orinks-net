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
  OPENS_PER_ADDRESS_PER_DAY,
  OPENS_PER_DAY,
  parseBlockList,
  parseFormSubmission,
  parseReport,
  PER_ADDRESS_PER_DAY,
  PER_DAY,
  reportFromDraft,
  takesApp,
  type ProblemReport,
  type StoredDraft,
} from "@/lib/problem-reports";

// Problem reports from Hearken games (hearken-report; the format is
// mailbag's). Two ways in:
//
// - POST /api/problem-reports: the game posts what the player wrote and its
//   logs, and this emails them through Resend to the address the contact
//   form uses. Answers are mailbag's: 202 sent, 400 malformed, 403 not a
//   game we take or a blocked address, 413 too big, 422 the reply address's
//   domain takes no mail, 429 over a limit, 502 the email did not go out.
//   Five a day from one address, a hundred in all.
// - POST /api/problem-reports/open, then the web form: the game posts its
//   logs with no description and gets a link (201, `{ code, url }`); the
//   browser opens the link, the player writes there, and the page posts to
//   /api/problem-reports/<code>, which emails the report with the logs the
//   game sent ahead (202) or says the link is gone (404). Opening the form
//   has its own limits (429): twenty a day from one address, three hundred
//   in all.
//
// The game never holds a mail password, and this never emails anyone else:
// the player's address rides on Reply-To.

const RESEND_SEND_URL = "https://api.resend.com/emails";
const DAY_MS = 24 * 60 * 60_000;

export type Deps = {
  /** Whether `key` may take one more report today, under `limit` a day. */
  allow(key: string, limit: number): Promise<boolean>;
  /** Whether `domain` has mail exchangers; null when the lookup itself failed. */
  takesMail(domain: string): Promise<boolean | null>;
  sendMail(body: Record<string, unknown>): Promise<Response>;
  /** Keeps a report's logs for the web form; the code of its link, or null when drafts are not set up. */
  stage(report: ProblemReport): Promise<string | null>;
  /** The draft a link's code names; null when there is none or it expired. */
  read(code: string): Promise<StoredDraft | null>;
  /** Drops the draft once its report was emailed. */
  discard(code: string): Promise<void>;
};

/**
 * The day's counters live on Convex when the games secret is set, so every
 * instance of this function shares them. Without it each instance counts
 * on its own (on Workers, each isolate in each location), which still
 * bounds a burst from one address.
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

/** The Convex client and the secret its writes carry, when both are set. */
function drafts() {
  const client = getConvexClient();
  const secret = gamesServerSecret();
  return client && secret ? { client, secret } : null;
}

async function stageOnConvex(report: ProblemReport): Promise<string | null> {
  const d = drafts();
  if (!d) return null;
  const logs = [];
  for (const attachment of report.attachments) {
    const url = (await d.client.mutation(anyApi.problemReports.uploadUrl, { secret: d.secret })) as string;
    const upload = await fetch(url, {
      body: attachment.text,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      method: "POST",
    });
    if (!upload.ok) throw new Error(`the log upload answered ${upload.status}`);
    const { storageId } = (await upload.json()) as { storageId: string };
    logs.push({ name: attachment.name, storageId, bytes: Buffer.byteLength(attachment.text, "utf8") });
  }
  return (await d.client.mutation(anyApi.problemReports.stage, {
    secret: d.secret,
    app: report.app,
    version: report.version,
    ...(report.commit ? { commit: report.commit } : {}),
    os: report.os,
    crashed: report.crashed,
    ...(report.details && report.details.length > 0 ? { details: report.details } : {}),
    logs,
    now: Date.now(),
  })) as string;
}

async function readFromConvex(code: string): Promise<StoredDraft | null> {
  const d = drafts();
  if (!d) return null;
  return (await d.client.action(anyApi.problemReports.read, { secret: d.secret, code })) as StoredDraft | null;
}

async function discardOnConvex(code: string): Promise<void> {
  const d = drafts();
  if (!d) return;
  await d.client.mutation(anyApi.problemReports.discard, { secret: d.secret, code });
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
  stage: stageOnConvex,
  read: readFromConvex,
  discard: discardOnConvex,
};

function refuse(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * The unpacked size a gzip stream declares in its last four bytes (mod 2^32),
 * or null when the bytes are not a gzip stream to begin with.
 */
function declaredGzipSize(raw: Uint8Array): number | null {
  // A gzip member starts with 1f 8b and is at least a 10-byte header and
  // an 8-byte trailer.
  if (raw.byteLength < 18 || raw[0] !== 0x1f || raw[1] !== 0x8b) return null;
  return new DataView(raw.buffer, raw.byteOffset + raw.byteLength - 4, 4).getUint32(0, true);
}

/** The report's JSON, unpacked when the game gzipped it, within the size cap. */
async function readBody(request: Request): Promise<{ body: unknown } | { status: 400 | 413; error: string }> {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return { status: 413, error: "the report is too big" };
  let bytes: Uint8Array = raw;
  if ((request.headers.get("content-encoding") ?? "").toLowerCase() === "gzip") {
    // The trailer says how big the stream unpacks to, so an oversized report
    // is refused before any of it is inflated. The cap on the inflate itself
    // is for a trailer that lies; the runtimes name that error differently
    // (Node's code is ERR_BUFFER_TOO_LARGE, workerd's is not), so any
    // failure past an honest trailer reads as a stream that is not gzip.
    const declared = declaredGzipSize(raw);
    if (declared !== null && declared > MAX_BODY_BYTES) return { status: 413, error: "the report is too big" };
    try {
      bytes = gunzipSync(raw, { maxOutputLength: MAX_BODY_BYTES });
    } catch {
      return { status: 400, error: "the report could not be unpacked" };
    }
  }
  try {
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { status: 400, error: "the report is not JSON" };
  }
}

/** A code as the links carry it: 40 hex digits. */
const CODE = /^[0-9a-f]{40}$/;

function mailEnv() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  return apiKey && from && to ? { from, to } : null;
}

/** A day's limits for one route, and the prefix its counters are kept under. */
type Limits = { key: string; perAddress: number; perDay: number };

/** A whole report, emailed at once. */
const REPORT_LIMITS: Limits = { key: "", perAddress: PER_ADDRESS_PER_DAY, perDay: PER_DAY };
/**
 * A report form opened. Its own counters, and more room: nothing is emailed
 * until the player sends the form, and five presses of Report a problem in
 * a day used to lock a player out of the form without one report sent.
 */
const OPEN_LIMITS: Limits = { key: "open:", perAddress: OPENS_PER_ADDRESS_PER_DAY, perDay: OPENS_PER_DAY };

/** The report, read and checked, or the refusal: the first steps both game-facing routes share. */
async function takeIn(
  request: Request,
  deps: Deps,
  options: { emptyDescription?: boolean; limits?: Limits } = {},
): Promise<{ report: ProblemReport; ip: string | null } | Response> {
  const limits = options.limits ?? REPORT_LIMITS;
  const ip = clientIp(request);
  if (isBlocked(ip, parseBlockList(process.env.PROBLEM_REPORT_BLOCK))) {
    return refuse(403, "reports from this address are not taken");
  }
  const read = await readBody(request);
  if (!("body" in read)) return refuse(read.status, read.error);
  const parsed = parseReport(read.body, options);
  if (!parsed.ok) return refuse(parsed.status, parsed.error);
  const report = parsed.report;
  if (!takesApp(report.app)) return refuse(403, `reports from ${report.app} are not taken`);
  // Blocked and malformed reports never count toward the limits.
  if (!(await deps.allow(`${limits.key}address:${ip ?? "unknown"}`, limits.perAddress))) {
    return refuse(429, "too many reports from this address today");
  }
  if (!(await deps.allow(`${limits.key}all`, limits.perDay))) return refuse(429, "too many reports today");
  return { report, ip };
}

/** Emails `report`; the answer for the route that asked. */
async function deliver(deps: Deps, report: ProblemReport, env: { from: string; to: string }): Promise<Response> {
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
      from: env.from,
      to: [env.to],
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
}

/** POST /api/problem-reports: a whole report from the game, emailed now. */
export function createHandler(deps: Deps) {
  return async function POST(request: Request) {
    const taken = await takeIn(request, deps);
    if (taken instanceof Response) return taken;
    const env = mailEnv();
    if (!env) return refuse(503, "problem reports are not set up on this server");
    return deliver(deps, taken.report, env);
  };
}

/**
 * POST /api/problem-reports/open: the game's logs, kept for the web form.
 * Answers 201 with the link's `code` and `url`.
 */
export function createOpenHandler(deps: Deps) {
  return async function POST(request: Request) {
    const taken = await takeIn(request, deps, { emptyDescription: true, limits: OPEN_LIMITS });
    if (taken instanceof Response) return taken;
    let code: string | null;
    try {
      code = await deps.stage(taken.report);
    } catch (error) {
      console.error("Problem reports: the logs could not be kept", error);
      return refuse(502, "the report could not be kept");
    }
    if (!code) return refuse(503, "problem reports are not set up on this server");
    const url = `${new URL(request.url).origin}/report/${code}`;
    return Response.json({ code, url }, { status: 201 });
  };
}

/**
 * POST /api/problem-reports/<code>: what the player wrote on the web form,
 * emailed with the logs the game sent ahead. The page reads `error` and
 * `field` from a refusal. The draft is dropped only once the email went
 * out, so a send that fails keeps the logs for another try; the page
 * keeps a double press from sending twice.
 */
export function createSendHandler(deps: Deps) {
  return async function POST(request: Request, code: string) {
    if (!CODE.test(code)) return refuse(404, "this report link is not one the site gave out");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, "the submission is not JSON");
    }
    const parsed = parseFormSubmission(body);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) }, { status: parsed.status });
    }
    const env = mailEnv();
    if (!env) return refuse(503, "problem reports are not set up on this server");
    if (parsed.submission.reply_to) {
      const domain = parsed.submission.reply_to.slice(parsed.submission.reply_to.lastIndexOf("@") + 1);
      if ((await deps.takesMail(domain)) === false) {
        return Response.json(
          { error: "Email cannot be delivered to that address. Check it, or leave it blank.", field: "reply_to" },
          { status: 422 },
        );
      }
    }
    let draft: StoredDraft | null;
    try {
      draft = await deps.read(code);
    } catch (error) {
      console.error("Problem reports: the draft could not be read", error);
      return refuse(502, "the report could not be read back");
    }
    if (!draft) return refuse(404, "this report link has expired or was already used");
    const report = reportFromDraft(draft, parsed.submission);
    // The address was checked above.
    const sent = await deliver({ ...deps, takesMail: async () => true }, report, env);
    if (sent.status !== 202) return sent;
    try {
      await deps.discard(code);
    } catch (error) {
      // The report went out; a draft left behind expires on its own.
      console.error("Problem reports: the sent draft could not be dropped", error);
    }
    return Response.json({ ok: true }, { status: 202 });
  };
}
