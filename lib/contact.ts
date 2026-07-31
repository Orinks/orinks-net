/**
 * Validation and formatting for the /contact form.
 *
 * Pure and dependency-free on purpose: the browser runs it to show inline
 * errors before a request goes out, and app/api/contact/route.ts runs the
 * exact same function again on the server, because client validation is a
 * convenience and never a control.
 */

export type ContactField = "name" | "email" | "subject" | "message";

export type ContactValues = Record<ContactField, string>;

export type ContactErrors = Partial<Record<ContactField, string>>;

export const CONTACT_FIELDS: readonly ContactField[] = [
  "name",
  "email",
  "subject",
  "message",
] as const;

export const CONTACT_LIMITS: Record<ContactField, number> = {
  name: 100,
  // 254 is the maximum length of an email address per RFC 5321.
  email: 254,
  subject: 150,
  message: 5000,
};

const EMPTY_VALUES: ContactValues = { name: "", email: "", subject: "", message: "" };

/**
 * Deliberately loose. The only address that truly validates is one that
 * receives mail, so this rejects the shapes that are certainly wrong
 * (no @, no dot in the domain, whitespace) and lets everything else through
 * rather than turning a real person away over a legal-but-unusual address.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** CR and LF terminate mail headers; anything containing them is an injection. */
const HEADER_BREAK = /[\r\n]/;

function readString(source: unknown, field: ContactField): string {
  if (!source || typeof source !== "object") {
    return "";
  }
  const value = (source as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export function validateContactSubmission(input: unknown): {
  values: ContactValues;
  errors: ContactErrors;
} {
  const values: ContactValues = { ...EMPTY_VALUES };
  const errors: ContactErrors = {};

  for (const field of CONTACT_FIELDS) {
    values[field] = readString(input, field).trim();
  }
  values.email = values.email.toLowerCase();

  if (!values.name) {
    errors.name = "Enter your name.";
  } else if (values.name.length > CONTACT_LIMITS.name) {
    errors.name = `Your name is too long. Use ${CONTACT_LIMITS.name} characters or fewer.`;
  } else if (HEADER_BREAK.test(values.name)) {
    errors.name = "Your name cannot contain line breaks.";
  }

  if (!values.email) {
    errors.email = "Enter your email address so a reply can reach you.";
  } else if (values.email.length > CONTACT_LIMITS.email) {
    errors.email = `That email address is too long. Use ${CONTACT_LIMITS.email} characters or fewer.`;
  } else if (HEADER_BREAK.test(values.email) || !EMAIL_SHAPE.test(values.email)) {
    errors.email = "Enter a complete email address, for example name@example.com.";
  }

  if (!values.subject) {
    errors.subject = "Enter a subject.";
  } else if (values.subject.length > CONTACT_LIMITS.subject) {
    errors.subject = `Your subject is too long. Use ${CONTACT_LIMITS.subject} characters or fewer.`;
  } else if (HEADER_BREAK.test(values.subject)) {
    errors.subject = "Your subject cannot contain line breaks.";
  }

  if (!values.message) {
    errors.message = "Enter your message.";
  } else if (values.message.length > CONTACT_LIMITS.message) {
    errors.message = `Your message is too long. Use ${CONTACT_LIMITS.message} characters or fewer.`;
  }

  return { values, errors };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Builds the mail that lands in the inbox. The sender's own address goes on
 * Reply-To (never on From, which must stay on the verified sending domain or
 * the mail is spoofing and gets filtered), so replying works normally.
 */
export function formatContactEmail(values: ContactValues): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `[orinks.net] ${values.subject}`;

  const text = [
    `From: ${values.name} <${values.email}>`,
    `Subject: ${values.subject}`,
    "",
    values.message,
    "",
    "--",
    "Sent from the contact form at https://orinks.net/contact",
  ].join("\n");

  const html = [
    `<p><strong>From:</strong> ${escapeHtml(values.name)} &lt;${escapeHtml(values.email)}&gt;</p>`,
    `<p><strong>Subject:</strong> ${escapeHtml(values.subject)}</p>`,
    `<p>${escapeHtml(values.message).replaceAll("\n", "<br />")}</p>`,
    "<hr />",
    '<p>Sent from the contact form at <a href="https://orinks.net/contact">orinks.net/contact</a></p>',
  ].join("\n");

  return { subject, text, html };
}
