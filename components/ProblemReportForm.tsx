"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_DESCRIPTION_CHARS } from "@/lib/problem-reports";

// The web form a game opens for a problem report. The game already sent its
// logs; they are listed here with a box each, so a player can leave one out.
// Field errors come back from the route with the field they belong to.
//
// Focus moves (to the error summary, to the success panel) run from effects
// after the render that shows the target, never from a frame callback, which
// can run before React commits and land on nothing.

type Status = "idle" | "submitting" | "sent";
type Field = "description" | "reply_to";

type Props = {
  code: string;
  version: string;
  crashed: boolean;
  logs: { name: string; bytes: number }[];
};

/** The error for a description, or null when it is fine. */
export function describeProblem(description: string): string | null {
  if (description.trim() === "") return "Say what happened.";
  const count = [...description].length;
  if (count > MAX_DESCRIPTION_CHARS) {
    return `Shorten what happened to ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters or fewer. It is ${count.toLocaleString("en-US")} now.`;
  }
  return null;
}

export function ProblemReportForm({ code, version, crashed, logs }: Props) {
  const [description, setDescription] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [attached, setAttached] = useState<Record<string, boolean>>(
    () => Object.fromEntries(logs.map((log) => [log.name, true])),
  );
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  // Bumped whenever the summary should take focus, including a repeated
  // failure that leaves its text unchanged.
  const [summaryFocus, setSummaryFocus] = useState(0);

  const baseId = useId();
  const fieldId = (field: Field) => `${baseId}-${field}`;
  const errorId = (field: Field) => `${baseId}-${field}-error`;
  const hintId = (field: Field) => `${baseId}-${field}-hint`;
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  useEffect(() => {
    if (status === "sent") successRef.current?.focus();
  }, [status]);

  function focusTarget(id: string) {
    document.getElementById(id)?.focus();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;
    setFormError("");
    setLinkExpired(false);

    const problem = describeProblem(description);
    const found: Partial<Record<Field, string>> = problem ? { description: problem } : {};
    setErrors(found);
    if (problem) {
      setSummaryFocus((n) => n + 1);
      return;
    }

    setStatus("submitting");
    try {
      const response = await fetch(`/api/problem-reports/${code}`, {
        body: JSON.stringify({
          description,
          reply_to: replyTo,
          omit: logs.filter((log) => !attached[log.name]).map((log) => log.name),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; field?: Field; ok?: boolean };
      if (response.ok && payload.ok) {
        setStatus("sent");
        return;
      }
      setStatus("idle");
      if (payload.field && payload.error) {
        setErrors({ [payload.field]: payload.error });
      } else if (response.status === 404) {
        setLinkExpired(true);
      } else {
        // The route's reasons are for its logs; the logs are still here for another try.
        setFormError("Please try again in a moment.");
      }
      setSummaryFocus((n) => n + 1);
    } catch {
      setStatus("idle");
      setFormError("The connection probably dropped. Please try again.");
      setSummaryFocus((n) => n + 1);
    }
  }

  if (status === "sent") {
    const address = replyTo.trim();
    return (
      <div
        className="max-w-2xl rounded-lg border border-line bg-soft-green p-6 focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-action"
        ref={successRef}
        tabIndex={-1}
      >
        <h2 className="text-2xl font-bold text-ink">Your report was sent</h2>
        <p className="mt-3 text-slate-700">
          {address ? `Any reply will go to ${address}. ` : ""}You can close this tab.
        </p>
      </div>
    );
  }

  const fields: Field[] = ["description", "reply_to"];
  const problems = fields
    .filter((field) => errors[field])
    .map((field) => ({ key: field, message: errors[field] as string, targetId: fieldId(field) }));
  const showSummary = problems.length > 0 || Boolean(formError) || linkExpired;
  const inputClass = (invalid: boolean) =>
    `mt-2 w-full rounded-md border bg-white px-3 py-3 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 ${
      invalid ? "border-2 border-red-700" : "border-line-strong"
    }`;
  const problemLink = (problem: { key: Field; message: string; targetId: string }) => (
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
  );

  return (
    // method="post" so a hydration failure yields an honest 405 rather than a
    // native GET that puts the whole report in the URL and browser history.
    <form className="max-w-2xl" method="post" noValidate onSubmit={handleSubmit}>
      {/* The focus target, with no role and no live region: the focus move
          alone reads it once, on every failure. */}
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
          <div className="rounded-lg border-2 border-red-700 bg-red-50 p-5">
            <h2 className="text-xl font-bold text-red-900">
              {problems.length > 1
                ? `There are ${problems.length} problems with this report`
                : problems.length === 1
                  ? "There is 1 problem with this report"
                  : "This report could not be sent"}
            </h2>
            {linkExpired ? (
              <p className="mt-2 text-red-900">
                This link has expired, or the report was already sent. To send a new one, choose Report a problem in the
                game again, or{" "}
                <a className="font-semibold underline hover:no-underline" href="/contact">
                  write through the contact form
                </a>
                .
              </p>
            ) : null}
            {formError ? <p className="mt-2 text-red-900">{formError}</p> : null}
            {problems.length === 1 ? (
              <p className="mt-2">{problemLink(problems[0])}</p>
            ) : problems.length > 1 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {problems.map((problem) => (
                  <li key={problem.key}>{problemLink(problem)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="text-slate-700">
        Version {version}
        {crashed ? ", which closed unexpectedly the last time it ran" : ""}.
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <label className="block font-semibold text-ink" htmlFor={fieldId("description")}>
            What happened
          </label>
          <p className="mt-1 text-sm text-slate-700" id={hintId("description")}>
            <span aria-hidden="true">Required. </span>
            {crashed ? "What were you doing when it closed?" : "What did you do, and what did you expect instead?"}
          </p>
          <textarea
            aria-describedby={[errors.description ? errorId("description") : null, hintId("description")]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={Boolean(errors.description)}
            className={inputClass(Boolean(errors.description))}
            id={fieldId("description")}
            name="description"
            onChange={(event) => {
              setDescription(event.target.value);
              if (errors.description) setErrors((e) => ({ ...e, description: undefined }));
            }}
            required
            rows={8}
            value={description}
          />
          {errors.description ? (
            <p className="mt-2 font-semibold text-red-900" id={errorId("description")}>
              {errors.description}
            </p>
          ) : null}
        </div>

        <div>
          <label className="block font-semibold text-ink" htmlFor={fieldId("reply_to")}>
            Your email address
          </label>
          <p className="mt-1 text-sm text-slate-700" id={hintId("reply_to")}>
            Optional. Only used to reply to you.
          </p>
          <input
            aria-describedby={[errors.reply_to ? errorId("reply_to") : null, hintId("reply_to")]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={Boolean(errors.reply_to)}
            autoComplete="email"
            className={inputClass(Boolean(errors.reply_to))}
            id={fieldId("reply_to")}
            name="reply_to"
            onChange={(event) => {
              setReplyTo(event.target.value);
              if (errors.reply_to) setErrors((e) => ({ ...e, reply_to: undefined }));
            }}
            type="email"
            value={replyTo}
          />
          {errors.reply_to ? (
            <p className="mt-2 font-semibold text-red-900" id={errorId("reply_to")}>
              {errors.reply_to}
            </p>
          ) : null}
        </div>

        {logs.length > 0 ? (
          <fieldset>
            <legend className="font-semibold text-ink">Logs to send with the report</legend>
            <div className="mt-2 space-y-2">
              {logs.map((log) => {
                const id = `${baseId}-log-${log.name}`;
                return (
                  <div className="flex items-center gap-3" key={log.name}>
                    <input
                      checked={attached[log.name] ?? true}
                      className="h-5 w-5 rounded border-line-strong text-action focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                      id={id}
                      name="attach"
                      onChange={(event) => setAttached((a) => ({ ...a, [log.name]: event.target.checked }))}
                      type="checkbox"
                      value={log.name}
                    />
                    <label className="text-ink" htmlFor={id}>
                      {log.name}
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <button
            aria-disabled={status === "submitting"}
            className="rounded-md bg-action px-5 py-3 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500"
            type="submit"
          >
            Send report
          </button>
          {/* Visible and live: Enter in the email field submits without the
              button having focus, so this is what says the send started. */}
          <p className="text-slate-700" role="status">
            {status === "submitting" ? "Sending your report." : ""}
          </p>
        </div>
      </div>
    </form>
  );
}
