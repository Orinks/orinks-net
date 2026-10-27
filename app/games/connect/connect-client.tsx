"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";
import { PLAYER_NAME_ERRORS, validatePlayerName, type PlayerNameError } from "./names";

type ClaimResult =
  | { ok: true; game: string }
  | { ok: false; code: "not_signed_in" | "no_player" | "unknown_code" | "rate_limited" | "name_taken" }
  | { ok: false; code: "name_rejected"; reason: "blocked" | "needs_letters" };

export type ClaimFn = (input: { userCode: string; displayName?: string }) => Promise<ClaimResult>;

const MESSAGES: Record<string, string> = {
  unknown_code: "That code was not recognised, or it has expired. Codes last ten minutes. Start connecting again in the game to hear a new code.",
  not_signed_in: "Sign in first, then enter your code again.",
  no_player: "Choose a player name, then enter your code again.",
  rate_limited: "Too many attempts. Wait a minute, then try again.",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";

// The form alone, with `claim` passed in so tests need no Convex or Clerk.
// Follows the Freight Fate activation page (app/activate/activate-client.tsx),
// which went through the site's accessibility review: an always-mounted
// alert, focus moved on every outcome, one plain text field for the code.
export default function ConnectClient({
  claim,
  initialCode,
  needsName = false,
  prefillName = "",
  titles = {},
}: {
  claim: ClaimFn;
  initialCode: string;
  needsName?: boolean;
  prefillName?: string;
  titles?: Record<string, string>;
}) {
  const codeId = useId();
  const hintId = useId();
  const errorId = useId();
  const nameId = useId();
  const nameHintId = `${nameId}-hint`;
  const nameErrorId = `${nameId}-error`;

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(prefillName);
  const [nameError, setNameError] = useState<PlayerNameError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (connected !== null) {
      successRef.current?.focus();
    }
  }, [connected]);

  // As on the activation page: focus moves to the name field so its error is
  // read with it, unless the field already has focus, when the alert says it.
  function showNameError(rejection: PlayerNameError) {
    setNameError(rejection);
    if (document.activeElement === nameRef.current) {
      setError(rejection.message);
    } else {
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setError(null);
    setInvalidCode(false);
    setNameError(null);

    let trimmedName = "";
    if (needsName) {
      trimmedName = name.trim();
      const rejection = validatePlayerName(trimmedName);
      if (rejection) {
        showNameError(rejection);
        return;
      }
    }

    setBusy(true);
    try {
      const result = await claim({ userCode: code, ...(needsName ? { displayName: trimmedName } : {}) });
      if (result.ok) {
        setConnected(titles[result.game] ?? "");
        return;
      }
      if (result.code === "name_taken") {
        showNameError(PLAYER_NAME_ERRORS.taken);
        return;
      }
      if (result.code === "name_rejected") {
        showNameError(result.reason === "needs_letters" ? PLAYER_NAME_ERRORS.letters : PLAYER_NAME_ERRORS.blocked);
        return;
      }
      setError(MESSAGES[result.code] ?? "Something went wrong. Try again in a moment.");
      if (result.code === "unknown_code") {
        setInvalidCode(true);
        requestAnimationFrame(() => codeRef.current?.focus());
      } else {
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const showHint = !initialCode;
  const describedBy = [errorId, showHint ? hintId : null].filter(Boolean).join(" ");
  const nameDescribedBy = [nameError ? nameErrorId : null, nameHintId].filter(Boolean).join(" ");
  const busyLabel = "Connecting…";
  const idleLabel = needsName ? "Create player and connect" : "Connect";

  return (
    <>
      {/* Always mounted, so a change to its text is announced. */}
      <p
        className={error ? "text-sm font-semibold text-red-700" : "sr-only"}
        id={errorId}
        ref={errorRef}
        role="alert"
        tabIndex={-1}
      >
        {error}
      </p>

      <div aria-atomic="true" className="sr-only" role={connected !== null ? undefined : "status"}>
        {busy ? busyLabel : ""}
      </div>

      {connected !== null ? (
        <div className="max-w-xl space-y-3 rounded border border-line bg-white p-5" role="status">
          <h2 className={`text-2xl font-bold text-ink ${focusRing}`} ref={successRef} tabIndex={-1}>
            {connected ? `${connected} connected` : "Game connected"}
          </h2>
          <p className="text-slate-800">You can return to {connected || "the game"}.</p>
        </div>
      ) : (
        <form className="max-w-xl space-y-5 rounded border border-line bg-white p-5" noValidate onSubmit={onSubmit}>
          <h2 className="text-2xl font-bold text-ink">
            {needsName ? "Choose a player name" : initialCode ? "Check your code" : "Enter your code"}
          </h2>

          {initialCode ? (
            <p className="text-slate-800">Your game sent {initialCode}.</p>
          ) : null}

          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor={codeId}>
              Code
            </label>
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
            {showHint ? (
              <p className="text-sm text-slate-600" id={hintId}>
                Eight letters and numbers, for example WKQR-3468. The dash is optional, and case does not matter.
              </p>
            ) : null}
          </div>

          {needsName ? (
            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor={nameId}>
                Player name{" "}
                <span aria-hidden="true" className="text-red-700">
                  *
                </span>
              </label>
              <input
                aria-describedby={nameDescribedBy}
                aria-invalid={nameError ? true : undefined}
                aria-required="true"
                className="w-full rounded border border-line-strong px-3 py-2 text-ink"
                id={nameId}
                maxLength={48}
                name="displayName"
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) {
                    setNameError(null);
                    // A name error may also be in the alert, which the code
                    // field reads as its description.
                    setError(null);
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
                3 to 48 characters, including at least three letters. Games may show it to other players.
              </p>
            </div>
          ) : null}

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

// The real wiring: a Clerk session, the account's player, and the mutation.
export function ConnectGate({ initialCode, titles }: { initialCode: string; titles: Record<string, string> }) {
  const { isLoaded, isSignedIn, user } = useUser();
  // Wait for Convex to hold the Clerk token before asking for the player, so
  // a signed-in account never briefly looks like one with no player.
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.games.getMyGamesPlayer, isAuthenticated ? {} : "skip");
  const resolved = isAuthenticated && me !== undefined;
  const claimActivation = useMutation(api.games.claimActivation);
  const claim = useCallback<ClaimFn>(
    (input) => claimActivation({ ...input, now: Date.now() }) as Promise<ClaimResult>,
    [claimActivation],
  );

  const regionRef = useRef<HTMLDivElement>(null);
  const previousSignedIn = useRef(isSignedIn);
  const accountStatus = !isLoaded
    ? "Loading your account…"
    : !isSignedIn
      ? "Sign in required."
      : !resolved
        ? "Checking your account…"
        : "";

  useEffect(() => {
    const justSignedIn = isSignedIn === true && previousSignedIn.current === false;
    previousSignedIn.current = isSignedIn;
    if (justSignedIn) {
      regionRef.current?.focus();
    }
  }, [isSignedIn]);

  // A status region only until the form takes over, which has its own: two
  // at once can drop or reorder what is announced.
  const statusDiv = (
    <div aria-atomic="true" className="sr-only" role={isSignedIn && resolved ? undefined : "status"}>
      {accountStatus}
    </div>
  );

  if (!isLoaded) {
    return (
      <>
        {statusDiv}
        <p>Loading your account…</p>
      </>
    );
  }
  if (!isSignedIn) {
    return (
      <>
        {statusDiv}
        <Section title="Sign in to continue">
          <AccountControls />
        </Section>
      </>
    );
  }
  return (
    <div aria-label="Game connection" ref={regionRef} role="region" tabIndex={-1}>
      {statusDiv}
      {!resolved ? (
        <p className="text-slate-800">Checking your account…</p>
      ) : (
        <ConnectClient
          claim={claim}
          initialCode={initialCode}
          needsName={me === null}
          prefillName={user?.username ?? user?.firstName ?? ""}
          titles={titles}
        />
      )}
    </div>
  );
}
