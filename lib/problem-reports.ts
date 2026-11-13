/**
 * Problem reports from Hearken games: a player's description of what went
 * wrong, the game's version and system, and its logs, posted by the game
 * and emailed to the developer by /api/problem-reports.
 *
 * The wire format is mailbag's (https://github.com/accessware/mailbag),
 * which hearken-report speaks: one JSON object, usually gzipped. Pure and
 * dependency-free so the route and its tests share one set of rules.
 */

/** The games whose reports are taken, by the name they send, lowercased. */
export const REPORT_APPS: readonly string[] = ["freight fate", "wicket's", "hello hearken"];

/** The most of a log a report carries; a game keeps the end of a longer one. */
export const MAX_LOG_BYTES = 1 << 20;
export const MAX_DESCRIPTION_CHARS = 20_000;
export const MAX_ATTACHMENTS = 4;
/** The most a gzipped body may unpack to: four logs and a long description. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;

/** Reports taken from one client address in a day, and in all. */
export const PER_ADDRESS_PER_DAY = 5;
export const PER_DAY = 100;

export type Attachment = { name: string; text: string };

export type ProblemReport = {
  app: string;
  version: string;
  commit?: string;
  os: string;
  description: string;
  reply_to?: string;
  crashed: boolean;
  attachments: Attachment[];
};

export type Parsed =
  | { ok: true; report: ProblemReport }
  | { ok: false; status: 400 | 413; error: string };

const ATTACHMENT_NAME = /^[A-Za-z0-9._-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function line(source: Record<string, unknown>, field: string, maxChars: number): string | { error: string } {
  const value = source[field];
  if (typeof value !== "string" || value.trim() === "") return { error: `${field} is empty` };
  if ([...value].length > maxChars) return { error: `${field} is too long` };
  if (CONTROL.test(value)) return { error: `${field} has a control character` };
  return value;
}

/** Whether `text` has the shape of an address; only DNS can say if it takes mail. */
export function looksLikeAddress(text: string): boolean {
  const at = text.indexOf("@");
  if (at <= 0) return false;
  const domain = text.slice(at + 1);
  return domain.includes(".") && !/\s/.test(text);
}

/** A report held for the web form: what the game sent ahead, without a description. */
export type StoredDraft = {
  app: string;
  version: string;
  commit?: string;
  os: string;
  crashed: boolean;
  logs: Attachment[];
};

/** What the report page sends: the description, a reply address, and logs to leave out. */
export type FormSubmission = { description: string; reply_to?: string; omit: string[] };

export type ParsedForm =
  | { ok: true; submission: FormSubmission }
  | { ok: false; status: 400 | 413; error: string; field?: "description" | "reply_to" };

export type ParseOptions = {
  /** For a report sent ahead of the web form, which has no description yet. */
  emptyDescription?: boolean;
};

/** The report in `body`, checked against the limits the game checks too. */
export function parseReport(body: unknown, options: ParseOptions = {}): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "the report is not an object" };
  }
  const source = body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [field, max] of [["app", 64], ["version", 64], ["os", 200]] as const) {
    const value = line(source, field, max);
    if (typeof value !== "string") return { ok: false, status: 400, error: value.error };
    fields[field] = value;
  }
  let commit: string | undefined;
  if (source.commit !== undefined && source.commit !== null) {
    const value = line(source, "commit", 64);
    if (typeof value !== "string") return { ok: false, status: 400, error: value.error };
    commit = value;
  }
  const description = source.description ?? "";
  if (typeof description !== "string") return { ok: false, status: 400, error: "description is not text" };
  if (description.trim() === "" && !options.emptyDescription) {
    return { ok: false, status: 400, error: "description is empty" };
  }
  if ([...description].length > MAX_DESCRIPTION_CHARS) {
    return { ok: false, status: 413, error: "description is too long" };
  }
  let reply_to: string | undefined;
  if (source.reply_to !== undefined && source.reply_to !== null) {
    const value = line(source, "reply_to", 254);
    if (typeof value !== "string") return { ok: false, status: 400, error: value.error };
    if (!looksLikeAddress(value)) return { ok: false, status: 400, error: "reply_to is not an email address" };
    reply_to = value;
  }
  const crashed = source.crashed === true;
  const rawAttachments = source.attachments ?? [];
  if (!Array.isArray(rawAttachments)) return { ok: false, status: 400, error: "attachments is not a list" };
  if (rawAttachments.length > MAX_ATTACHMENTS) return { ok: false, status: 413, error: "too many attachments" };
  const attachments: Attachment[] = [];
  for (const entry of rawAttachments) {
    if (!entry || typeof entry !== "object") return { ok: false, status: 400, error: "an attachment is not an object" };
    const name = line(entry as Record<string, unknown>, "name", 64);
    if (typeof name !== "string") return { ok: false, status: 400, error: `attachment ${name.error}` };
    if (!ATTACHMENT_NAME.test(name)) {
      return { ok: false, status: 400, error: "an attachment name has characters other than letters, digits, '.', '-' and '_'" };
    }
    const text = (entry as Record<string, unknown>).text;
    if (typeof text !== "string") return { ok: false, status: 400, error: "an attachment has no text" };
    if (Buffer.byteLength(text, "utf8") > MAX_LOG_BYTES) return { ok: false, status: 413, error: "an attachment is too long" };
    attachments.push({ name, text });
  }
  return {
    ok: true,
    report: {
      app: fields.app,
      version: fields.version,
      ...(commit ? { commit } : {}),
      os: fields.os,
      description,
      ...(reply_to ? { reply_to } : {}),
      crashed,
      attachments,
    },
  };
}

/** What the report page posted, checked the way a game's report is. */
export function parseFormSubmission(body: unknown): ParsedForm {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "the submission is not an object" };
  }
  const source = body as Record<string, unknown>;
  const description = source.description;
  if (typeof description !== "string" || description.trim() === "") {
    return { ok: false, status: 400, error: "Say what happened.", field: "description" };
  }
  const count = [...description].length;
  if (count > MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `Shorten what happened to ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters or fewer. It is ${count.toLocaleString("en-US")} now.`,
      field: "description",
    };
  }
  let reply_to: string | undefined;
  if (typeof source.reply_to === "string" && source.reply_to.trim() !== "") {
    const value = source.reply_to.trim();
    if ([...value].length > 254 || CONTROL.test(value) || !looksLikeAddress(value)) {
      return {
        ok: false,
        status: 400,
        error: "Enter an email address like name@example.com, or leave it blank.",
        field: "reply_to",
      };
    }
    reply_to = value;
  }
  const omit = Array.isArray(source.omit)
    ? source.omit.filter((name): name is string => typeof name === "string")
    : [];
  return { ok: true, submission: { description, ...(reply_to ? { reply_to } : {}), omit } };
}

/** The report the page's submission makes with the draft the game sent ahead. */
export function reportFromDraft(draft: StoredDraft, submission: FormSubmission): ProblemReport {
  return {
    app: draft.app,
    version: draft.version,
    ...(draft.commit ? { commit: draft.commit } : {}),
    os: draft.os,
    description: submission.description,
    ...(submission.reply_to ? { reply_to: submission.reply_to } : {}),
    crashed: draft.crashed,
    attachments: draft.logs.filter((log) => !submission.omit.includes(log.name)),
  };
}

/** Whether the relay takes reports from `app`. Case does not matter. */
export function takesApp(app: string): boolean {
  return REPORT_APPS.includes(app.trim().toLowerCase());
}

/** The subject line: `[Freight Fate 1.9.6] crash: The window closed`. */
export function subjectOf(report: ProblemReport): string {
  const first = report.description.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  const summary = [...first].slice(0, 80).join("");
  return `[${report.app} ${report.version}] ${report.crashed ? "crash: " : ""}${summary}`;
}

/**
 * The email body: what the player wrote, under a heading so it reads as the
 * report and not as a repeat of the subject, then the game and system details.
 */
export function bodyOf(report: ProblemReport): string {
  const lines = [
    "What happened:",
    report.description.trim(),
    "",
    `App: ${report.app} ${report.version}${report.commit ? ` (commit ${report.commit})` : ""}`,
    `System: ${report.os}`,
    `Crashed on its last run: ${report.crashed ? "yes" : "no"}`,
  ];
  if (report.reply_to) lines.push(`Reply to: ${report.reply_to}`);
  return lines.join("\n") + "\n";
}

export type Email = {
  subject: string;
  text: string;
  reply_to?: string;
  attachments: { filename: string; content: string }[];
};

/** The email for `report`, its logs attached as text files (Base64 for Resend). */
export function composeEmail(report: ProblemReport): Email {
  return {
    subject: subjectOf(report),
    text: bodyOf(report),
    ...(report.reply_to ? { reply_to: report.reply_to } : {}),
    attachments: report.attachments.map((a) => ({
      filename: a.name,
      content: Buffer.from(a.text, "utf8").toString("base64"),
    })),
  };
}

/** The blocked addresses and ranges in `PROBLEM_REPORT_BLOCK`: `203.0.113.7, 198.51.100.0/24`. */
export function parseBlockList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/** Whether `ip` is one of the blocked addresses or inside a blocked IPv4 range. */
export function isBlocked(ip: string | null, blocked: readonly string[]): boolean {
  if (!ip) return false;
  const value = ipv4ToInt(ip);
  for (const entry of blocked) {
    if (entry === ip) return true;
    const slash = entry.indexOf("/");
    if (slash === -1 || value === null) continue;
    const base = ipv4ToInt(entry.slice(0, slash));
    const bits = Number(entry.slice(slash + 1));
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if (((value & mask) >>> 0) === ((base & mask) >>> 0)) return true;
  }
  return false;
}
