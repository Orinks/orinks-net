"use client";

import { useId, useRef, useState } from "react";
import { MAX_DESCRIPTION_CHARS } from "@/lib/problem-reports";

// The web form a game opens for a problem report. The game already sent its
// logs; they are listed here with a box each, so a player can leave one out.
// Field errors come back from the route with the field they belong to.

type Status = "idle" | "submitting" | "sent";
type Field = "description" | "reply_to";

type Props = {
  code: string;
  app: string;
  version: string;
  crashed: boolean;
  logs: { name: string; bytes: number }[];
};

function kilobytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ProblemReportForm({ code, app, version, crashed, logs }: Props) {
  const [description, setDescription] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [attached, setAttached] = useState<Record<string, boolean>>(
    () => Object.fromEntries(logs.map((log) => [log.name, true])),
  );
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Bumped on every submit so the summary's alert element remounts and
  // fires again on a repeated failure.
  const [attempt, setAttempt] = useState(0);

  const baseId = useId();
  const fieldId = (field: Field) => `${baseId}-${field}`;
  const errorId = (field: Field) => `${baseId}-${field}-error`;
  const hintId = (field: Field) => `${baseId}-${field}-hint`;
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  function focusTarget(id: string) {
    document.getElementById(id)?.focus();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;
    setAttempt((n) => n + 1);
    setFormError("");

    const found: Partial<Record<Field, string>> = {};
    if (description.trim() === "") found.description = "Say what happened.";
    else if ([...description].length > MAX_DESCRIPTION_CHARS) {
      found.description = `Keep it under ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters.`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
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
        requestAnimationFrame(() => successRef.current?.focus());
        return;
      }
      setStatus("idle");
      if (payload.field && payload.error) {
        setErrors({ [payload.field]: payload.error });
      } else if (response.status === 404) {
        setFormError("This link has expired or was already used. Open Report a problem in the game again.");
      } else {
        setFormError(payload.error ?? "The report could not be sent. Please try again.");
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    } catch {
      setStatus("idle");
      setFormError("The report could not be sent, which usually means the connection dropped. Please try again.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  if (status === "sent") {
    return (
      <div
        className="max-w-2xl rounded-lg border border-line bg-soft-green p-6 focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-action"
        ref={successRef}
        role="status"
        tabIndex={-1}
      >
        <h2 className="text-2xl font-bold text-ink">Your report was sent</h2>
        <p className="mt-3 text-slate-700">
          Thank you. {replyTo.trim() ? "A reply will go to the address you gave. " : ""}You can close this tab.
        </p>
      </div>
    );
  }

  const fields: Field[] = ["description", "reply_to"];
  const problems = fields
    .filter((field) => errors[field])
    .map((field) => ({ key: field, message: errors[field] as string, targetId: fieldId(field) }));
  const showSummary = problems.length > 0 || Boolean(formError);
  const inputClass = (invalid: boolean) =>
    `mt-2 w-full rounded-md border bg-white px-3 py-3 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 ${
      invalid ? "border-2 border-red-700" : "border-line-strong"
    }`;

  return (
    // method="post" so a hydration failure yields an honest 405 rather than a
    // native GET that puts the whole report in the URL and browser history.
    <form className="max-w-2xl" method="post" noValidate onSubmit={handleSubmit}>
      {/* The focus target only: no role and no name, so NVDA reads the list
          instead of announcing a name and stopping. */}
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
          <div className="rounded-lg border-2 border-red-700 bg-red-50 p-5" key={attempt} role="alert">
            <h2 className="text-xl font-bold text-red-900">
              {problems.length > 0
                ? `There ${problems.length === 1 ? "is 1 problem" : `are ${problems.length} problems`} with this report`
                : "This report could not be sent"}
            </h2>
            {formError ? <p className="mt-2 text-red-900">{formError}</p> : null}
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

      <p className="text-slate-700">
        {app} {version}
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
            aria-describedby={[hintId("description"), errors.description ? errorId("description") : null]
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
              <span className="sr-only">Error: </span>
              {errors.description}
            </p>
          ) : null}
        </div>

        <div>
          <label className="block font-semibold text-ink" htmlFor={fieldId("reply_to")}>
            Your email address, for a reply
          </label>
          <p className="mt-1 text-sm text-slate-700" id={hintId("reply_to")}>
            Optional. Only used to reply to you.
          </p>
          <input
            aria-describedby={[hintId("reply_to"), errors.reply_to ? errorId("reply_to") : null]
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
              <span className="sr-only">Error: </span>
              {errors.reply_to}
            </p>
          ) : null}
        </div>

        {logs.length > 0 ? (
          <fieldset>
            <legend className="font-semibold text-ink">Attached from the game</legend>
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
                      {log.name}, {kilobytes(log.bytes)}
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div>
          <button
            aria-disabled={status === "submitting"}
            className="rounded-md bg-action px-5 py-3 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500"
            type="submit"
          >
            {status === "submitting" ? "Sending..." : "Send report"}
          </button>
        </div>
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {status === "submitting" ? "Sending your report." : ""}
      </p>
    </form>
  );
}
