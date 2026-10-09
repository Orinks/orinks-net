"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { api } from "@/convex/_generated/api";
import { STATE_OPTIONS, validateSuggestion } from "@/convex/freightFateStationRules";

type Kind = "terrestrial" | "web";
type Field = "kind" | "name" | "streamUrl" | "callSign" | "state" | "city" | "frequency" | "genre" | "note";
type Values = Record<Exclude<Field, "kind">, string> & { kind: Kind | "" };

const EMPTY: Values = {
  kind: "", name: "", streamUrl: "", callSign: "", state: "", city: "", frequency: "", genre: "", note: "",
};

// Which field a refusal belongs to, so the summary link lands on it. The
// stream checks (stream_*, duplicate_*, already_declined) are about the stream
// address; anything else (limits, sign-in, a dropped connection) is about no
// field, and is shown as plain text with nothing marked invalid.
const REASON_FIELD: Record<string, Field> = {
  invalid_kind: "kind",
  invalid_name: "name",
  name_too_long: "name",
  invalid_stream_url: "streamUrl",
  invalid_call_sign: "callSign",
  invalid_state: "state",
  invalid_frequency: "frequency",
  city_too_long: "city",
  genre_too_long: "genre",
  note_too_long: "note",
};

function fieldForReason(reason: string): Field | null {
  if (REASON_FIELD[reason]) return REASON_FIELD[reason];
  if (/^(stream_|duplicate_|already_declined)/.test(reason)) return "streamUrl";
  return null;
}

const TERRESTRIAL_FIELDS: Field[] = ["callSign", "state", "city", "frequency"];

const LABELS: Record<Exclude<Field, "kind">, string> = {
  name: "Station name",
  streamUrl: "Stream address",
  callSign: "Call sign",
  state: "State",
  city: "City",
  frequency: "Frequency",
  genre: "Format",
  note: "Anything else we should know",
};

const HINTS: Partial<Record<Field, string>> = {
  streamUrl: "The direct link to the audio stream, often ending in .mp3, .aac, .pls or .m3u. A station's web page will not work.",
  callSign: "Like WXYZ or KABC-FM.",
  frequency: "Like 101.5 or 1090.",
  genre: "Like classic country or news talk.",
  note: "Up to 280 characters.",
};

const OPTIONAL: Field[] = ["city", "frequency", "genre", "note"];

const input =
  "mt-2 w-full rounded-md border bg-white px-3 py-3 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2";

export function StationSuggestionClient() {
  const { isLoaded, isSignedIn } = useUser();
  const driver = useQuery(api.freightFate.getMyDriver, isSignedIn ? {} : "skip");

  if (!isLoaded || (isSignedIn && driver === undefined)) {
    return <p role="status">Loading your account…</p>;
  }
  if (!isSignedIn) {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-2xl font-bold text-ink">Sign in to suggest a station</h2>
        <p className="text-slate-700">Use the account your driver signs in with.</p>
        <AccountControls />
      </div>
    );
  }
  if (!driver) {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-2xl font-bold text-ink">Set up your driver first</h2>
        <p className="text-slate-700">
          <Link className="font-semibold text-action underline" href="/freight-fate/online/setup">
            Create your driver on the online setup page
          </Link>
          , then come back here.
        </p>
      </div>
    );
  }
  return <StationSuggestionForm />;
}

function StationSuggestionForm() {
  const suggest = useAction(api.freightFateStationVetting.suggestStationSignedIn);
  const [values, setValues] = useState<Values>(EMPTY);
  const [problem, setProblem] = useState<{ field: Field | null; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"idle" | "checking" | "sent">("idle");
  const [sentMessage, setSentMessage] = useState("");

  const baseId = useId();
  const fieldId = (field: Field) => `${baseId}-${field}`;
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "sent") successRef.current?.focus();
  }, [status]);

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Switching to online only removes the broadcast fields, so an error on
    // one of them would point at nothing.
    if (problem && (problem.field === field || (field === "kind" && problem.field && TERRESTRIAL_FIELDS.includes(problem.field)))) {
      setProblem(null);
    }
  }

  function fail(reason: string, message: string) {
    setProblem({ field: fieldForReason(reason), message });
    setAttempt((count) => count + 1);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "checking") return;
    const form = values.kind === "web"
      ? { kind: "web", name: values.name, streamUrl: values.streamUrl, genre: values.genre, note: values.note }
      : values;
    const checked = validateSuggestion(form);
    if (!checked.ok) {
      fail(checked.reason, checked.message);
      return;
    }
    setProblem(null);
    setStatus("checking");
    try {
      const result = await suggest(form as Record<string, string>);
      if (result.ok) {
        setSentMessage(result.message);
        setStatus("sent");
        return;
      }
      setStatus("idle");
      fail(result.reason, result.message);
    } catch {
      setStatus("idle");
      fail("unreachable", "Your suggestion could not be sent, which usually means the connection dropped. Please try again.");
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
        <h2 className="text-2xl font-bold text-ink">Suggestion sent</h2>
        <p className="mt-3 text-slate-700">{sentMessage}</p>
        <p className="mt-3">
          <a className="font-semibold text-action underline hover:no-underline" href="/freight-fate/suggest-a-station">
            Suggest another station
          </a>
        </p>
      </div>
    );
  }

  const textField = (field: Exclude<Field, "kind" | "state">, multiline = false) => {
    const invalid = problem?.field === field;
    const hint = HINTS[field];
    const describedBy = [hint ? `${fieldId(field)}-hint` : null, invalid ? `${fieldId(field)}-error` : null]
      .filter(Boolean)
      .join(" ");
    const shared = {
      "aria-describedby": describedBy || undefined,
      "aria-invalid": invalid,
      className: `${input} ${invalid ? "border-2 border-red-700" : "border-line-strong"}`,
      id: fieldId(field),
      name: field,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(field, event.target.value),
      required: !OPTIONAL.includes(field),
      value: values[field],
    };
    return (
      <div>
        <label className="block font-semibold text-ink" htmlFor={fieldId(field)}>
          {LABELS[field]}
          {OPTIONAL.includes(field) ? <span className="font-normal text-slate-700"> (optional)</span> : null}
        </label>
        {hint ? (
          <p className="mt-1 text-sm text-slate-700" id={`${fieldId(field)}-hint`}>
            {hint}
          </p>
        ) : null}
        {multiline ? (
          <textarea {...shared} rows={4} />
        ) : (
          <input {...shared} autoComplete="off" type={field === "streamUrl" ? "url" : "text"} />
        )}
        {invalid ? (
          <p className="mt-2 font-semibold text-red-900" id={`${fieldId(field)}-error`}>
            <span className="sr-only">Error: </span>
            {problem.message}
          </p>
        ) : null}
      </div>
    );
  };

  const kindInvalid = problem?.field === "kind";
  const stateInvalid = problem?.field === "state";

  return (
    <form className="max-w-2xl" method="post" noValidate onSubmit={handleSubmit}>
      {/* The focus target carries no role or name, so NVDA reads the alert's
          content instead of stopping at a label (the contact form's lesson). */}
      <div
        className={problem ? "mb-8 rounded-lg focus:outline-none focus:ring-4 focus:ring-red-700 focus:ring-offset-2" : "sr-only"}
        ref={summaryRef}
        tabIndex={-1}
      >
        {problem ? (
          <div className="rounded-lg border-2 border-red-700 bg-red-50 p-5" key={attempt} role="alert">
            <h2 className="text-xl font-bold text-red-900">This suggestion was not sent</h2>
            <p className="mt-2">
              {problem.field === null ? (
                <span className="font-semibold text-red-900">{problem.message}</span>
              ) : (
              <a
                className="inline-block py-1 font-semibold text-red-900 underline hover:no-underline focus:outline-none focus:ring-4 focus:ring-red-700 focus:ring-offset-2"
                href={`#${fieldId(problem.field)}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(fieldId(problem.field!))?.focus();
                }}
              >
                {problem.message}
              </a>
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <fieldset
          aria-describedby={kindInvalid ? `${fieldId("kind")}-error` : undefined}
          id={fieldId("kind")}
          tabIndex={-1}
        >
          <legend className="font-semibold text-ink">How does it broadcast?</legend>
          {(
            [
              ["terrestrial", "On AM or FM, and online"],
              ["web", "Online only"],
            ] as const
          ).map(([kind, label]) => (
            <label className="mt-3 flex items-center gap-3" key={kind}>
              <input
                aria-describedby={kindInvalid ? `${fieldId("kind")}-error` : undefined}
                checked={values.kind === kind}
                className="h-5 w-5 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                name="kind"
                onChange={() => update("kind", kind)}
                required
                type="radio"
                value={kind}
              />
              {label}
            </label>
          ))}
          {kindInvalid ? (
            <p className="mt-2 font-semibold text-red-900" id={`${fieldId("kind")}-error`}>
              <span className="sr-only">Error: </span>
              {problem.message}
            </p>
          ) : null}
        </fieldset>

        {textField("name")}
        {textField("streamUrl")}

        {values.kind === "terrestrial" ? (
          <>
            {textField("callSign")}
            <div>
              <label className="block font-semibold text-ink" htmlFor={fieldId("state")}>
                {LABELS.state}
              </label>
              <select
                aria-describedby={stateInvalid ? `${fieldId("state")}-error` : undefined}
                aria-invalid={stateInvalid}
                className={`${input} ${stateInvalid ? "border-2 border-red-700" : "border-line-strong"}`}
                id={fieldId("state")}
                name="state"
                onChange={(event) => update("state", event.target.value)}
                required
                value={values.state}
              >
                <option value="">Choose a state</option>
                {STATE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
              {stateInvalid ? (
                <p className="mt-2 font-semibold text-red-900" id={`${fieldId("state")}-error`}>
                  <span className="sr-only">Error: </span>
                  {problem.message}
                </p>
              ) : null}
            </div>
            {textField("city")}
            {textField("frequency")}
          </>
        ) : null}

        {textField("genre")}
        {textField("note", true)}

        <div>
          <button
            aria-disabled={status === "checking"}
            className="rounded-md bg-action px-5 py-3 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500"
            type="submit"
          >
            {status === "checking" ? "Checking the stream..." : "Send suggestion"}
          </button>
        </div>
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {status === "checking" ? "Checking the stream." : ""}
      </p>
    </form>
  );
}
