"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CONTACT_FIELDS,
  CONTACT_LIMITS,
  type ContactErrors,
  type ContactField,
  type ContactValues,
  validateContactSubmission,
} from "@/lib/contact";

type Status = "idle" | "submitting" | "sent";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      sitekey: string;
      size: "compact" | "flexible" | "normal";
    },
  ) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const CAPTCHA_REQUIRED_MESSAGE = "Confirm you are human using the checkbox below, then send again.";

const FIELD_LABELS: Record<ContactField, string> = {
  name: "Your name",
  email: "Your email address",
  subject: "Subject",
  message: "Message",
};

const FIELD_HINTS: Record<ContactField, string> = {
  name: "What should you be called in the reply?",
  email: "Only used to reply to you.",
  subject: "A few words about what this is regarding.",
  message: `Up to ${CONTACT_LIMITS.message.toLocaleString("en-US")} characters.`,
};

const EMPTY_VALUES: ContactValues = { name: "", email: "", subject: "", message: "" };

/** Loads the Turnstile script once per page, no matter how many callers ask. */
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.turnstile) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);

  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = TURNSTILE_SCRIPT;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
    document.head.appendChild(script);
  });
}

export function ContactForm({ siteKey }: { siteKey: string }) {
  const [values, setValues] = useState<ContactValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Until the first submit, typing must never raise an error underneath the
  // cursor. Afterwards, errors clear as they are fixed.
  const [hasSubmitted, setHasSubmitted] = useState(false);
  // Bumped on every submit so the summary's alert element remounts. Without
  // it, two identical failures in a row leave the node in place and the alert
  // never fires a second time.
  const [attempt, setAttempt] = useState(0);

  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaBroken, setCaptchaBroken] = useState(false);

  const baseId = useId();
  const fieldId = (field: ContactField) => `${baseId}-${field}`;
  const errorId = (field: ContactField) => `${baseId}-${field}-error`;
  const hintId = (field: ContactField) => `${baseId}-${field}-hint`;
  const captchaGroupId = `${baseId}-captcha`;

  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        // Strict Mode runs effects twice; without this guard the second pass
        // stacks a duplicate checkbox on the page.
        if (cancelled || widgetIdRef.current || !captchaRef.current || !window.turnstile) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(captchaRef.current, {
          callback: (token) => {
            setCaptchaToken(token);
            setCaptchaBroken(false);
            // Retract "tick the box" the moment they tick the box, or the
            // summary sits there telling them to do what they just did.
            setFormError((current) => (current === CAPTCHA_REQUIRED_MESSAGE ? "" : current));
          },
          "error-callback": () => {
            setCaptchaToken("");
            setCaptchaBroken(true);
          },
          // Tokens die after five minutes, which a long message can outlast.
          "expired-callback": () => setCaptchaToken(""),
          sitekey: siteKey,
          // `normal` is a fixed 300px wide and overflows a 320px viewport once
          // the page padding and this panel's own padding are taken out.
          size: "compact",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCaptchaBroken(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  /** Every send spends the token, so the widget has to start over each time. */
  const resetCaptcha = useCallback(() => {
    setCaptchaToken("");

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  function update(field: ContactField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));

    if (hasSubmitted) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function focusTarget(id: string) {
    document.getElementById(id)?.focus();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // aria-disabled does not stop activation the way `disabled` would, so the
    // in-flight guard lives here instead.
    if (status === "submitting") {
      return;
    }

    setHasSubmitted(true);
    setAttempt((count) => count + 1);
    setFormError("");

    const { errors: found } = validateContactSubmission(values);
    setErrors(found);

    if (Object.keys(found).length > 0) {
      // Focus lands on the summary so the count and the reasons are read out
      // before anything else, and every problem is one link away.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    if (!captchaToken) {
      setFormError(
        captchaBroken
          ? "The human check could not load, so the form cannot send. Please email orin8722@gmail.com instead."
          : CAPTCHA_REQUIRED_MESSAGE,
      );
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    setStatus("submitting");

    try {
      const response = await fetch("/api/contact", {
        body: JSON.stringify({ ...values, turnstileToken: captchaToken }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: ContactErrors;
        ok?: boolean;
      };

      if (response.ok && payload.ok) {
        setStatus("sent");
        requestAnimationFrame(() => successRef.current?.focus());
        return;
      }

      setStatus("idle");
      resetCaptcha();

      if (payload.fieldErrors) {
        setErrors(payload.fieldErrors);
      }

      setFormError(payload.error ?? "Your message could not be sent. Please try again.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    } catch {
      setStatus("idle");
      resetCaptcha();
      setFormError(
        "Your message could not be sent, which usually means the connection dropped. Please try again.",
      );
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  if (status === "sent") {
    return (
      <div
        className="max-w-2xl rounded-lg border border-line bg-soft-green p-6 focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-action"
        ref={successRef}
        // Announces the whole panel. A focus move alone reads only the
        // heading, which leaves out where the reply is going.
        role="status"
        tabIndex={-1}
      >
        <h2 className="text-2xl font-bold text-ink">Your message was sent</h2>
        <p className="mt-3 text-slate-700">
          Thank you for writing. A reply will go to {values.email}. If you do not hear back within a
          few days, email orin8722@gmail.com directly in case the message went astray.
        </p>
        <p className="mt-3">
          <a className="font-semibold text-action underline hover:no-underline" href="/contact">
            Send another message
          </a>
        </p>
      </div>
    );
  }

  // Captcha trouble is presented exactly like a field problem: counted in the
  // heading, and a link that lands you on the thing to fix.
  const captchaProblem = formError === CAPTCHA_REQUIRED_MESSAGE;
  const problems = [
    ...CONTACT_FIELDS.filter((field) => errors[field]).map((field) => ({
      key: field as string,
      message: errors[field] as string,
      targetId: fieldId(field),
    })),
    ...(captchaProblem
      ? [{ key: "captcha", message: CAPTCHA_REQUIRED_MESSAGE, targetId: captchaGroupId }]
      : []),
  ];
  const showSummary = problems.length > 0 || Boolean(formError);

  return (
    // method="post" so a hydration failure yields an honest 405 rather than a
    // native GET that puts the whole message in the URL and browser history.
    <form className="max-w-2xl" method="post" noValidate onSubmit={handleSubmit}>
      {/* Outer element is the focus target only: deliberately no role and no
          accessible name, because naming it makes NVDA announce the name and
          stop without ever reading the list. */}
      <div
        className={
          showSummary
            ? "mb-8 rounded-lg focus:outline-none focus:ring-4 focus:ring-red-700 focus:ring-offset-2"
            : "sr-only"
        }
        ref={summaryRef}
        tabIndex={-1}
      >
        {showSummary ? (
          <div
            className="rounded-lg border-2 border-red-700 bg-red-50 p-5"
            key={attempt}
            role="alert"
          >
            <h2 className="text-xl font-bold text-red-900">
              {problems.length > 0
                ? `There ${problems.length === 1 ? "is 1 problem" : `are ${problems.length} problems`} with this form`
                : "This message could not be sent"}
            </h2>
            {formError && !captchaProblem ? <p className="mt-2 text-red-900">{formError}</p> : null}
            {problems.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {problems.map((problem) => (
                  <li key={problem.key}>
                    <a
                      className="inline-block py-1 font-semibold text-red-900 underline hover:no-underline focus:outline-none focus:ring-4 focus:ring-red-700 focus:ring-offset-2"
                      href={`#${problem.targetId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusTarget(problem.targetId);
                      }}
                    >
                      {problem.message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        {CONTACT_FIELDS.map((field) => {
          const invalid = Boolean(errors[field]);
          const shared = {
            "aria-describedby": [hintId(field), invalid ? errorId(field) : null]
              .filter(Boolean)
              .join(" "),
            "aria-invalid": invalid,
            className: `mt-2 w-full rounded-md border bg-white px-3 py-3 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 ${
              invalid ? "border-2 border-red-700" : "border-line-strong"
            }`,
            id: fieldId(field),
            name: field,
            // No maxLength: it truncates a long paste silently, with no event
            // for a screen reader to announce. Submit validation catches it
            // and can actually say so.
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              update(field, event.target.value),
            required: true,
            value: values[field],
          };

          return (
            <div key={field}>
              <label className="block font-semibold text-ink" htmlFor={fieldId(field)}>
                {FIELD_LABELS[field]}
              </label>
              <p className="mt-1 text-sm text-slate-700" id={hintId(field)}>
                {/* Visible for sighted users, hidden from the description:
                    the native required state already says this out loud. */}
                <span aria-hidden="true">Required. </span>
                {FIELD_HINTS[field]}
              </p>
              {field === "message" ? (
                <textarea {...shared} rows={8} />
              ) : (
                <input
                  {...shared}
                  autoComplete={field === "name" ? "name" : field === "email" ? "email" : "off"}
                  type={field === "email" ? "email" : "text"}
                />
              )}
              {invalid ? (
                <p className="mt-2 font-semibold text-red-900" id={errorId(field)}>
                  {/* Seam between the hint and the problem, which otherwise
                      run together as one sentence. */}
                  <span className="sr-only">Error: </span>
                  {errors[field]}
                </p>
              ) : null}
            </div>
          );
        })}

        <div
          className="rounded-lg border border-line bg-white p-5"
          id={captchaGroupId}
          tabIndex={-1}
        >
          <h2 className="text-xl font-bold text-ink">Human check</h2>
          <p className="mt-2 text-slate-700">
            Required, and it keeps spam out of the inbox. Select the &ldquo;Verify you are
            human&rdquo; checkbox below. There is no picture puzzle and no audio challenge &mdash;
            the checkbox is the whole thing.
          </p>
          <div className="mt-4 overflow-x-auto" ref={captchaRef} />
          {captchaBroken ? (
            <p className="mt-3 font-semibold text-red-900">
              The human check could not load. Please email orin8722@gmail.com instead.
            </p>
          ) : null}
        </div>

        <div>
          <button
            aria-disabled={status === "submitting"}
            className="rounded-md bg-action px-5 py-3 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500"
            type="submit"
          >
            {status === "submitting" ? "Sending..." : "Send message"}
          </button>
        </div>

        <p className="text-slate-700">
          Would rather not use a form? Email{" "}
          <a className="font-semibold text-action underline" href="mailto:orin8722@gmail.com">
            orin8722@gmail.com
          </a>{" "}
          directly.
        </p>
      </div>

      {/* Only the in-flight state lives here. The finished states move focus
          instead, so nothing is announced twice. */}
      <p aria-live="polite" className="sr-only" role="status">
        {status === "submitting" ? "Sending your message." : ""}
      </p>
    </form>
  );
}
