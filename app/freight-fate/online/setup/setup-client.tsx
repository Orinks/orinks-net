"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

type Visibility = "public" | "private" | "unlisted";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";

// Two always-mounted, sr-only live regions: successes/progress go polite,
// failures go assertive. The clear-then-set on the next frame forces the same
// message to re-announce (React won't re-fire an unchanged text node).
function useAnnouncer() {
  const [politeStatus, setPolite] = useState("");
  const [errorStatus, setError] = useState("");

  const announce = useCallback((setter: (value: string) => void, message: string) => {
    setter("");
    requestAnimationFrame(() => requestAnimationFrame(() => setter(message)));
  }, []);

  const announcePolite = useCallback((message: string) => announce(setPolite, message), [announce]);
  const announceError = useCallback((message: string) => announce(setError, message), [announce]);

  return { politeStatus, errorStatus, announcePolite, announceError };
}

export function FreightFateSetupClient() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <Section title="Your driver">
        <p aria-live="polite" role="status">
          Loading your account…
        </p>
      </Section>
    );
  }

  if (!isSignedIn) {
    return (
      <Section title="Sign in to continue">
        <p>
          Freight Fate drivers are Orinks accounts. Sign in to create your driver identity and get a
          posting token for the game.
        </p>
        <p>
          <SignInButton mode="modal">
            <button
              className={`rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark ${focusRing}`}
              type="button"
            >
              Sign in
            </button>
          </SignInButton>
        </p>
      </Section>
    );
  }

  return <DriverSetup />;
}

function DriverSetup() {
  const { user } = useUser();
  const myDriver = useQuery(api.freightFate.getMyDriver, {});
  const provision = useMutation(api.freightFate.provisionDriver);
  const { politeStatus, errorStatus, announcePolite, announceError } = useAnnouncer();

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [initialized, setInitialized] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const tokenHeadingRef = useRef<HTMLHeadingElement>(null);

  // Prefill once the driver query resolves: from the existing driver when
  // editing, otherwise from the Clerk handle (WCAG 3.3.7 Redundant Entry).
  useEffect(() => {
    if (initialized || myDriver === undefined) {
      return;
    }
    if (myDriver) {
      setName(myDriver.displayName);
      setVisibility(myDriver.visibility);
    } else {
      setName(user?.username ?? user?.firstName ?? "");
      setVisibility("private");
    }
    setInitialized(true);
  }, [initialized, myDriver, user]);

  // Bring the reader to the one-time token the moment it is revealed.
  useEffect(() => {
    if (issuedToken) {
      tokenHeadingRef.current?.focus();
    }
  }, [issuedToken]);

  const copyText = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopyStatus(`${label} copied to clipboard.`);
        announcePolite(`${label} copied to clipboard.`);
      } catch {
        announceError(`Copy failed. Select the ${label} field and press Control C to copy it.`);
      }
    },
    [announcePolite, announceError],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 48) {
      setNameError("Enter a driver name of 1 to 48 characters.");
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }

    const editing = myDriver != null;
    setNameError(null);
    setPending(true);
    announcePolite(editing ? "Saving changes." : "Setting up your driver.");

    try {
      const result = await provision({
        displayName: trimmed,
        visibility,
        rotateToken: false,
        now: Date.now(),
      });
      if (result.token) {
        setCopyStatus("");
        setIssuedToken(result.token);
        announcePolite("Driver ready. Your one-time token is shown below — copy it now.");
      } else {
        announcePolite("Changes saved.");
      }
    } catch {
      announceError("Save failed. Your changes were not applied. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleRotate() {
    if (pending || !myDriver) {
      return;
    }
    setPending(true);
    announcePolite("Rotating token.");
    try {
      const result = await provision({
        displayName: myDriver.displayName,
        visibility: myDriver.visibility,
        rotateToken: true,
        now: Date.now(),
      });
      if (result.token) {
        setCopyStatus("");
        setIssuedToken(result.token);
        announcePolite("Token rotated. The new token is shown below — copy it now. The old token no longer works.");
      }
    } catch {
      announceError("Token rotation failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const nameDescribedBy =
    ["displayName-hint", nameError ? "displayName-error" : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <>
      {/* Always mounted so announcements are never missed. */}
      <div aria-atomic="true" className="sr-only" role="status">
        {politeStatus}
      </div>
      <div aria-atomic="true" className="sr-only" role="alert">
        {errorStatus}
      </div>

      {issuedToken ? (
        <section
          aria-labelledby="ff-token-heading"
          className="space-y-3 rounded border border-line bg-white p-5"
        >
          <h2
            className={`text-xl font-bold text-ink ${focusRing}`}
            id="ff-token-heading"
            ref={tokenHeadingRef}
            tabIndex={-1}
          >
            Your driver token
          </h2>
          <p className="font-semibold text-red-800" id="ff-token-desc">
            Shown once. Copy it into Freight Fate on your PC now — you will not be able to see it
            again.
          </p>
          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor="ff-driver-token">
              Driver token
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                aria-describedby="ff-token-desc"
                autoComplete="off"
                className="w-full rounded border border-line px-3 py-2 font-mono text-ink"
                id="ff-driver-token"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                spellCheck={false}
                type="text"
                value={issuedToken}
              />
              <button
                className={`shrink-0 rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark ${focusRing}`}
                onClick={() => copyText(issuedToken, "Token")}
                type="button"
              >
                Copy token
              </button>
            </div>
            {copyStatus ? <p className="text-sm text-slate-700">{copyStatus}</p> : null}
          </div>
          <p className="text-slate-800">
            In Freight Fate, open Online Sharing and paste this token. Your Driver ID is{" "}
            <code className="font-mono">{myDriver?.driverId}</code>.
          </p>
        </section>
      ) : null}

      {myDriver === undefined ? (
        <Section title="Your driver">
          <p>Loading your driver…</p>
        </Section>
      ) : (
        <Section title={myDriver ? "Your driver" : "Set up your driver"}>
          <form
            className="max-w-xl space-y-5 rounded border border-line bg-white p-5"
            noValidate
            onSubmit={handleSubmit}
          >
            <p className="text-slate-800">
              {myDriver
                ? "Update your driver name or visibility. Your Driver ID and posting token stay the same unless you rotate the token."
                : "Create your driver identity. This makes a driver profile and issues a posting token you paste into Freight Fate on your PC."}
            </p>
            <p className="text-sm text-slate-600">Fields marked with * are required.</p>

            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor="displayName">
                Driver name{" "}
                <span aria-hidden="true" className="text-red-700">
                  *
                </span>
              </label>
              <input
                aria-describedby={nameDescribedBy}
                aria-invalid={nameError ? true : undefined}
                aria-required="true"
                className="w-full rounded border border-line px-3 py-2 text-ink"
                id="displayName"
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
              <p className="text-sm text-slate-600" id="displayName-hint">
                1 to 48 characters. Shown on your public profile and the drivers board.
              </p>
              {nameError ? (
                <p className="text-sm text-red-700" id="displayName-error">
                  <span aria-hidden="true">⚠ </span>
                  {nameError}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-ink" htmlFor="visibility">
                Profile visibility
              </label>
              <select
                className="w-full rounded border border-line px-3 py-2 text-ink"
                id="visibility"
                name="visibility"
                onChange={(event) => setVisibility(event.target.value as Visibility)}
                value={visibility}
              >
                <option value="private">
                  Private: accept posts, do not show trip details publicly
                </option>
                <option value="unlisted">
                  Unlisted: show trip details to anyone with the profile link
                </option>
                <option value="public">
                  Public: show trip details to anyone and list this driver on the live drivers board
                  while on duty
                </option>
              </select>
            </div>

            <button
              aria-disabled={pending || undefined}
              className={`rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
              type="submit"
            >
              {pending
                ? myDriver
                  ? "Saving…"
                  : "Setting up…"
                : myDriver
                  ? "Save changes"
                  : "Set up driver"}
            </button>
          </form>

          {myDriver ? (
            <div className="mt-6 space-y-4 rounded border border-line bg-white p-5">
              <div className="space-y-2">
                <label className="block font-semibold text-ink" htmlFor="ff-driver-id">
                  Driver ID
                </label>
                <p className="text-sm text-slate-600">
                  Paste this into Freight Fate along with your token. It is not secret.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    autoComplete="off"
                    className="w-full rounded border border-line px-3 py-2 font-mono text-ink"
                    id="ff-driver-id"
                    onFocus={(event) => event.currentTarget.select()}
                    readOnly
                    spellCheck={false}
                    type="text"
                    value={myDriver.driverId}
                  />
                  <button
                    className={`shrink-0 rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 ${focusRing}`}
                    onClick={() => copyText(myDriver.driverId, "Driver ID")}
                    type="button"
                  >
                    Copy Driver ID
                  </button>
                </div>
                {copyStatus ? <p className="text-sm text-slate-700">{copyStatus}</p> : null}
              </div>

              {myDriver.visibility === "private" ? (
                <p className="text-slate-700">Your profile is private, so it is not shown publicly.</p>
              ) : (
                <p>
                  <Link href={`/freight-fate/drivers/${myDriver.driverId}`}>
                    View your public driver profile
                  </Link>
                  .
                </p>
              )}

              <div className="space-y-2">
                <p className="text-slate-800">A posting token is active for this driver.</p>
                <p className="text-sm text-slate-600">
                  Rotating replaces the current token. The old token stops working, and you paste the
                  new one into Freight Fate.
                </p>
                <button
                  aria-disabled={pending || undefined}
                  className={`rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
                  onClick={handleRotate}
                  type="button"
                >
                  {pending ? "Rotating…" : "Rotate token"}
                </button>
              </div>
            </div>
          ) : null}
        </Section>
      )}
    </>
  );
}
