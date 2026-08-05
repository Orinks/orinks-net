"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";
import {
  NAME_HINT_PREFIX,
  NAME_HINT_SUFFIX,
  NAME_RULES_HREF,
  NAME_RULES_LINK_TEXT,
  TAKEN_ERROR,
  nameRejectionForReason,
  validateDriverName,
  type NameError,
} from "@/lib/freight-fate-driver-name";

type ClaimFailureCode =
  | "not_signed_in"
  | "no_driver"
  | "unknown_code"
  | "too_many_computers"
  | "rate_limited"
  | "name_taken";

// claimActivation can also create a driver in the same transaction when the
// account has none and a name was supplied. When ActivateGate resolves the
// account to have no driver yet, ActivateClient renders the three-field
// shape below and always supplies a name, so name_taken/name_rejected are
// real, reachable outcomes here -- not just carried for type completeness.
type ClaimResult =
  | { ok: true }
  | { ok: false; code: ClaimFailureCode }
  | { ok: false; code: "name_rejected"; reason: "blocked" | "needs_letters" };

type ClaimFn = (input: {
  userCode: string;
  label?: string;
  displayName?: string;
}) => Promise<ClaimResult>;

// claimActivation returns a discriminated result rather than throwing (an
// earlier design threw a ConvexError, but that rolled back the rate
// limiter's writes on every rejection). Branch on result.ok / result.code,
// never on a caught error.
//
// Partial, not Record<ClaimFailureCode, string>: name_taken and
// name_rejected are field errors on the driver-name input (handled
// separately in onSubmit via TAKEN_ERROR / nameRejectionForReason, the same
// wording the setup page uses), not generic alert text, so they are
// deliberately absent here.
const MESSAGES: Partial<Record<string, string>> = {
  unknown_code:
    "That code was not recognised, or it has expired. Codes last ten minutes. Start setup again in Freight Fate to get a new one.",
  not_signed_in: "Sign in first, then enter your code again.",
  no_driver: "Set up your driver on the Freight Fate setup page first, then come back here.",
  too_many_computers:
    "You have connected the maximum number of computers. Remove one on the setup page, then try again.",
  rate_limited: "Too many attempts. Wait a minute, then try again.",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";

// The plain-form component: takes an injected `claim` so tests need no
// Convex or Clerk provider. `ActivateGate` below is the wrapper that wires
// the real mutation and the sign-in requirement.
export default function ActivateClient({
  claim,
  initialCode,
  needsDriver = false,
  prefillName = "",
}: {
  claim: ClaimFn;
  initialCode: string;
  // Set by ActivateGate once getMyDriver resolves to null: the account is
  // signed in but has no driver, so this renders the three-field shape and
  // sends displayName on submit. Defaults to false (the two-field shape)
  // so every existing caller/test is unaffected.
  needsDriver?: boolean;
  prefillName?: string;
}) {
  const codeId = useId();
  const labelFieldId = useId();
  const errorId = useId();
  const hintId = useId();
  const nameFieldId = useId();
  const nameHintId = `${nameFieldId}-hint`;
  const nameErrorId = `${nameFieldId}-error`;

  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState("");
  const [name, setName] = useState(prefillName);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [error, setError] = useState("");
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  // Requirement: success moves focus explicitly, via a ref in a useEffect
  // keyed on the success flag -- the same mechanism setup-client.tsx uses
  // for tokenHeadingRef. Whatever renders on success must move focus there
  // itself; nothing here relies on a live region alone to carry it, since
  // the form below unmounts and focus would otherwise fall silently to
  // <body> at the exact moment the page succeeds.
  useEffect(() => {
    if (done) {
      successHeadingRef.current?.focus();
    }
  }, [done]);

  // Shows a rejection on the name field. Moving focus makes the reader
  // announce label, invalid state, and error text in one pass -- the same
  // mechanism setup-client.tsx's showNameError uses. But when the submit
  // came from Enter inside the name field itself, focus() below is a no-op
  // (it is already focused), so nothing would announce the change; that
  // case routes the message through the alert live region instead.
  function showNameError(rejection: NameError) {
    setNameError(rejection);
    if (document.activeElement === nameRef.current) {
      setError(rejection.message);
    } else {
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Guard clause, not the native `disabled` attribute -- disabling the
    // focused submit button can drop focus to <body> mid-interaction.
    if (busy) {
      return;
    }
    setError("");
    setInvalidCode(false);
    setNameError(null);

    // Name pre-checks run client-side before any network call, so a locally
    // invalid name can never collide with a code error in one round trip --
    // the same shared predicate DriverSetup's handleSubmit calls, so the two
    // pages cannot drift apart on thresholds the way two hand-copied
    // versions could.
    let trimmedName = "";
    if (needsDriver) {
      trimmedName = name.trim();
      const rejection = validateDriverName(trimmedName);
      if (rejection) {
        showNameError(rejection);
        return;
      }
    }

    setBusy(true);
    try {
      const result = await claim({
        userCode: code,
        label: label.trim() || undefined,
        ...(needsDriver ? { displayName: trimmedName } : {}),
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      if (result.code === "name_taken") {
        showNameError(TAKEN_ERROR);
        return;
      }
      if (result.code === "name_rejected") {
        showNameError(nameRejectionForReason(result.reason));
        return;
      }
      const message = MESSAGES[result.code] ?? "Something went wrong. Try again in a moment.";
      setError(message);
      if (result.code === "unknown_code") {
        // A field problem: mark it invalid and move the reader there.
        setInvalidCode(true);
        requestAnimationFrame(() => codeRef.current?.focus());
      } else {
        // not_signed_in, no_driver, too_many_computers, rate_limited: none of
        // these mean the code is wrong, so the field is never marked
        // invalid. Move focus to the alert instead of accusing the field.
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } finally {
      setBusy(false);
    }
  }

  const describedBy = `${errorId} ${hintId}`;
  const nameDescribedBy =
    [nameError ? nameErrorId : null, nameHintId].filter(Boolean).join(" ") || undefined;
  const busyLabel = needsDriver ? "Setting up and connecting…" : "Connecting…";
  const idleLabel = needsDriver
    ? "Create driver and connect this computer"
    : "Connect this computer";

  return (
    <>
      {/* Requirement: the error element is always mounted; only its text
          changes. Never conditionally mount this -- a live region must
          already be in the accessibility tree before its content changes,
          or the change is missed. */}
      <p
        className={error ? "text-sm font-semibold text-red-700" : "sr-only"}
        id={errorId}
        ref={errorRef}
        role="alert"
        tabIndex={-1}
      >
        {error}
      </p>

      {/* Always-mounted polite live region for the busy state ("Connecting…"
          is spoken, not just displayed on the button -- a player who
          submitted with Enter from the code field never hears button text).
          Its role moves off once `done`, so there is never more than one
          role="status" element in the tree at a time -- the success panel
          below becomes the sole status region. */}
      <div aria-atomic="true" className="sr-only" role={done ? undefined : "status"}>
        {busy ? busyLabel : ""}
      </div>

      {done ? (
        <div className="max-w-xl space-y-3 rounded border border-line bg-white p-5" role="status">
          <h2 className={`text-2xl font-bold text-ink ${focusRing}`} ref={successHeadingRef} tabIndex={-1}>
            Computer connected
          </h2>
          <p className="text-slate-800">
            You can return to Freight Fate. It will say when it is connected.
          </p>
        </div>
      ) : (
        <form
          className="max-w-xl space-y-5 rounded border border-line bg-white p-5"
          noValidate
          onSubmit={onSubmit}
        >
          {/* Distinct from the page's H1 ("Activate Freight Fate" in
              app/activate/page.tsx's PageHeader) in both shapes -- a heading
              that repeats the page title verbatim is indistinguishable from
              it in a screen reader's heading list, the duplicate-heading
              defect fixed earlier in this page's history. */}
          <h2 className="text-2xl font-bold text-ink">
            {needsDriver ? "Create your driver and activate Freight Fate" : "Connect this computer"}
          </h2>
          {needsDriver ? (
            <p className="text-slate-800">
              This orinks.net account does not have a Freight Fate driver yet, so this page will
              also create one.
            </p>
          ) : null}
          <p className="text-slate-800">
            Enter the activation code Freight Fate is showing on this computer.
          </p>

          {initialCode ? (
            <p className="text-slate-800">
              We received a code from Freight Fate: {initialCode}. Check it matches what the game
              read to you.
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor={codeId}>
              Activation code
            </label>
            {/* One plain text input -- never a segmented per-character
                OTP-style control, a known screen-reader and keyboard hazard.
                No inputMode of "numeric" or "tel": the code contains
                letters. No auto-inserted dash or forced case: per-keystroke
                DOM mutation trips virtual cursors, and entry already accepts
                any case with the dash optional. */}
            <input
              aria-describedby={describedBy}
              aria-invalid={invalidCode || undefined}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="w-full rounded border border-line-strong px-3 py-2 font-mono text-ink"
              id={codeId}
              name="code"
              onChange={(event) => {
                setCode(event.target.value);
                if (invalidCode) {
                  setInvalidCode(false);
                }
              }}
              ref={codeRef}
              spellCheck={false}
              type="text"
              value={code}
            />
            {/* Format facts live in persistent hint text tied via
                aria-describedby, not a placeholder -- placeholders vanish on
                input and are not reliably announced. */}
            <p className="text-sm text-slate-600" id={hintId}>
              Eight letters and numbers, for example WKQR-3468. The dash is optional, and it does
              not matter whether you use upper or lower case.
            </p>
          </div>

          {needsDriver ? (
            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor={nameFieldId}>
                Driver name{" "}
                <span aria-hidden="true" className="text-red-700">
                  *
                </span>
              </label>
              <input
                aria-describedby={nameDescribedBy}
                aria-invalid={nameError ? true : undefined}
                aria-required="true"
                className="w-full rounded border border-line-strong px-3 py-2 text-ink"
                id={nameFieldId}
                maxLength={48}
                name="displayName"
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) {
                    setNameError(null);
                  }
                }}
                ref={nameRef}
                required
                type="text"
                value={name}
              />
              {nameError ? (
                <p className="text-sm text-red-700" id={nameErrorId}>
                  <span aria-hidden="true">⚠ </span>
                  {nameError.message}
                </p>
              ) : null}
              <p className="text-sm text-slate-600" id={nameHintId}>
                {NAME_HINT_PREFIX}{" "}
                <Link className={focusRing} href={NAME_RULES_HREF}>
                  {NAME_RULES_LINK_TEXT}
                </Link>
                {NAME_HINT_SUFFIX}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor={labelFieldId}>
              Name this computer
            </label>
            <p className="text-sm text-slate-600" id={`${labelFieldId}-hint`}>
              Just for you, to tell your computers apart — for example Desktop or Laptop. Leave it
              blank for “My computer”.
            </p>
            <input
              aria-describedby={`${labelFieldId}-hint`}
              autoComplete="off"
              className="w-full rounded border border-line-strong px-3 py-2 text-ink"
              id={labelFieldId}
              maxLength={64}
              name="label"
              onChange={(event) => setLabel(event.target.value)}
              type="text"
              value={label}
            />
          </div>

          <button
            aria-disabled={busy || undefined}
            className={`rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
            type="submit"
          >
            {busy ? busyLabel : idleLabel}
          </button>
        </form>
      )}
    </>
  );
}

// The real wiring: requires a Clerk session the way the setup page does
// (copied from FreightFateSetupClient in setup-client.tsx) and passes a
// `claim` that calls the real Convex mutation with now: Date.now().
export function ActivateGate({ initialCode }: { initialCode: string }) {
  const { isLoaded, isSignedIn, user } = useUser();
  // Same query DriverSetup uses. No fetchQuery-with-Clerk-token pattern
  // exists elsewhere in this codebase (checked: nothing in app/ resolves
  // Convex data server-side via a Clerk token the way page.tsx resolves
  // ?code=), so this client-side gate is the floor the a11y requirement
  // calls for, not a corner cut.
  const myDriver = useQuery(api.freightFate.getMyDriver, {});
  const claimActivation = useMutation(api.freightFateActivation.claimActivation);
  const claim = useCallback<ClaimFn>(
    (input) => claimActivation({ ...input, now: Date.now() }),
    [claimActivation],
  );

  const regionRef = useRef<HTMLDivElement>(null);
  const previousSignedIn = useRef(isSignedIn);
  const accountStatus = !isLoaded
    ? "Loading your account…"
    : !isSignedIn
      ? "Sign in required."
      : myDriver === undefined
        ? "Checking your driver…"
        : "";

  useEffect(() => {
    const justSignedIn = isSignedIn === true && previousSignedIn.current === false;
    previousSignedIn.current = isSignedIn;
    if (justSignedIn) {
      regionRef.current?.focus();
    }
  }, [isSignedIn]);

  // The single sr-only status announcement, rendered at exactly one of the
  // three call sites below depending on state -- never two at once. For the
  // signed-in states it renders inside the region itself (see the third
  // branch): the sign-in transition above already moves focus to that
  // region, so a "Checking your driver…" announcement rendered outside it
  // would sit at a spot the reader's cursor has already left.
  const statusDiv = (
    <div aria-atomic="true" className="sr-only" role="status">
      {accountStatus}
    </div>
  );

  return (
    <>
      {!isLoaded ? (
        <>
          {statusDiv}
          <Section title="Activate Freight Fate">
            <p>Loading your account…</p>
          </Section>
        </>
      ) : !isSignedIn ? (
        <>
          {statusDiv}
          <Section title="Sign in to continue">
            <p>
              Freight Fate drivers are linked to orinks.net accounts. Sign in — or create an account
              — then enter the activation code Freight Fate is showing on this computer.
            </p>
            <AccountControls />
          </Section>
        </>
      ) : (
        <div aria-label="Freight Fate activation" ref={regionRef} role="region" tabIndex={-1}>
          {statusDiv}
          {myDriver === undefined ? (
            <p className="text-slate-800">Checking your driver…</p>
          ) : (
            <ActivateClient
              claim={claim}
              initialCode={initialCode}
              needsDriver={myDriver === null}
              prefillName={user?.username ?? user?.firstName ?? ""}
            />
          )}
        </div>
      )}
    </>
  );
}
