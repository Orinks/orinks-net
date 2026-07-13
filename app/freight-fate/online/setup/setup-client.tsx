"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

export function shouldAnnounceDriverReady(alreadyAnnounced: boolean, driver: unknown | undefined) {
  return !alreadyAnnounced && driver !== undefined;
}

// kind picks the inline rendering: "blocked" renders PREFIX + the rules link
// instead of message; every other kind renders message verbatim.
type NameError = { kind: "length" | "letters" | "blocked" | "taken"; message: string };
type PendingAction = "save" | "rotate" | null;
type CopyStatus = {
  area: "issued-driver-id" | "issued-token" | "driver";
  kind: "success" | "error";
  message: string;
};

const BLOCKED_MESSAGE_PREFIX = "That name isn't allowed. Choose a different name, or check the ";
const RULES_LINK_TEXT = "driver naming rules";

const LETTERS_ERROR: NameError = {
  kind: "letters",
  message: "Driver names must include at least three letters. Choose a different name.",
};

// provisionDriver throws ConvexError({ code: "name_taken" }) when another
// account already uses the name, and ConvexError({ code: "name_rejected",
// reason }) when it fails moderation screening; anything else is a real
// failure.
function nameRejection(error: unknown): NameError | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data = error.data as { code?: string; reason?: string } | undefined;
  if (data?.code === "name_taken") {
    return {
      kind: "taken",
      message: "That driver name is already taken. Choose a different name.",
    };
  }
  if (data?.code !== "name_rejected") {
    return null;
  }
  if (data.reason === "needs_letters") {
    return LETTERS_ERROR;
  }
  return {
    kind: "blocked",
    message: `${BLOCKED_MESSAGE_PREFIX}${RULES_LINK_TEXT}.`,
  };
}

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
  const setupRef = useRef<HTMLDivElement>(null);
  const previousSignedIn = useRef(isSignedIn);
  const accountStatus = !isLoaded ? "Loading your account…" : isSignedIn ? "" : "Sign in required.";

  useEffect(() => {
    const justSignedIn = isSignedIn === true && previousSignedIn.current === false;
    previousSignedIn.current = isSignedIn;
    if (justSignedIn) {
      setupRef.current?.focus();
    }
  }, [isSignedIn]);
  return <>
    <div aria-atomic="true" className="sr-only" role="status">{accountStatus}</div>
    {!isLoaded ? (
      <Section title="Your driver">
        <p>Loading your account…</p>
      </Section>
    ) : !isSignedIn ? (
      <Section title="Sign in to continue">
        <p>
          Freight Fate drivers are linked to orinks.net accounts. Sign in — or create an account — to
          set up your driver identity and get a posting token for the game.
        </p>
        <AccountControls />
      </Section>
    ) : (
      <div aria-label="Freight Fate driver setup" ref={setupRef} role="region" tabIndex={-1}>
        <DriverSetup />
      </div>
    )}
  </>;
}

function DriverSetup() {
  const { user } = useUser();
  const myDriver = useQuery(api.freightFate.getMyDriver, {});
  const provision = useMutation(api.freightFate.provisionDriver);
  const { politeStatus, errorStatus, announcePolite, announceError } = useAnnouncer();

  const [name, setName] = useState("");
  const [profileSharing, setProfileSharing] = useState(false);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [saveError, setSaveError] = useState("");
  const [rotateError, setRotateError] = useState("");
  // Carries BOTH values from the provision result: the reactive getMyDriver
  // query can lag the mutation, so myDriver may still be null at the moment
  // the panel renders and focus arrives (a11y review: an empty ID field
  // would be copied as nothing).
  const [issued, setIssued] = useState<{ token: string; driverId: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);
  const [initialized, setInitialized] = useState(false);
  const driverReadyAnnounced = useRef(false);

  useEffect(() => {
    if (shouldAnnounceDriverReady(driverReadyAnnounced.current, myDriver)) {
      driverReadyAnnounced.current = true;
      announcePolite("Driver settings ready.");
    }
  }, [announcePolite, myDriver]);

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
      setProfileSharing(myDriver.sharingEnabled === true);
    } else {
      setName(user?.username ?? user?.firstName ?? "");
      setProfileSharing(false);
    }
    setInitialized(true);
  }, [initialized, myDriver, user]);

  // Bring the reader to the connect panel the moment it is revealed.
  useEffect(() => {
    if (issued) {
      tokenHeadingRef.current?.focus();
    }
  }, [issued]);

  const copyText = useCallback(
    async (value: string, label: string, area: CopyStatus["area"]) => {
      try {
        await navigator.clipboard.writeText(value);
        const message = `${label} copied to clipboard.`;
        setCopyStatus({ area, kind: "success", message });
        announcePolite(message);
      } catch {
        const message = `Copy failed. Select the ${label} field and press Control C to copy it.`;
        setCopyStatus({ area, kind: "error", message });
        announceError(message);
      }
    },
    [announceError, announcePolite],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingAction) {
      return;
    }

    // Shows a rejection on the name field. Moving focus makes the reader
    // announce label, invalid state, and error text in one pass — but when
    // the submit came from Enter inside the field itself, focus() is a no-op
    // and nothing would be read, so that case falls back to the live region.
    function showNameError(rejection: NameError) {
      setNameError(rejection);
      if (document.activeElement === nameRef.current) {
        announceError(rejection.message);
      } else {
        requestAnimationFrame(() => nameRef.current?.focus());
      }
    }

    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 48) {
      showNameError({ kind: "length", message: "Enter a driver name of 3 to 48 characters." });
      return;
    }
    // Mirrors the server's minimum-letters rule so the common case gets
    // instant feedback instead of a round-trip rejection.
    if ((trimmed.match(/\p{L}/gu) ?? []).length < 3) {
      showNameError(LETTERS_ERROR);
      return;
    }

    const editing = myDriver != null;
    setNameError(null);
    setSaveError("");
    setPendingAction("save");
    announcePolite(editing ? "Saving changes." : "Setting up your driver.");

    try {
      const result = await provision({
        displayName: trimmed,
        visibility: profileSharing ? "public" : "private",
        expandedSharingConsent: profileSharing,
        rotateToken: false,
        now: Date.now(),
      });
      if (result.token) {
        setCopyStatus(null);
        setIssued({ token: result.token, driverId: result.driverId });
        announcePolite(
          `Driver ready. Profile sharing is ${profileSharing ? "on" : "off"}. Copy your Driver ID and one-time token below.`,
        );
      } else {
        announcePolite(
          `Changes saved. Profile sharing is ${profileSharing ? "on" : "off"}.`,
        );
      }
    } catch (error) {
      // A name rejection (taken or moderated) is field feedback, not a save
      // failure: inline error + focus move (or the live-region fallback),
      // same as the client-side checks above.
      const rejection = nameRejection(error);
      if (rejection) {
        showNameError(rejection);
      } else {
        setProfileSharing(myDriver?.sharingEnabled === true);
        const message = "Save failed. Your changes were not applied. Please try again.";
        setSaveError(message);
        announceError(message);
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRotate() {
    if (pendingAction || !myDriver) {
      return;
    }
    setRotateError("");
    setPendingAction("rotate");
    announcePolite("Rotating token.");
    try {
      const result = await provision({
        displayName: myDriver.displayName,
        visibility: myDriver.sharingEnabled ? "public" : "private",
        expandedSharingConsent: myDriver.sharingEnabled,
        rotateToken: true,
        now: Date.now(),
      });
      if (result.token) {
        setCopyStatus(null);
        setIssued({ token: result.token, driverId: result.driverId });
        announcePolite("Token rotated. The new token is shown below — copy it now. The old token no longer works.");
      }
    } catch {
      const message = "Token rotation failed. Please try again.";
      setRotateError(message);
      announceError(message);
    } finally {
      setPendingAction(null);
    }
  }

  const nameDescribedBy =
    [nameError ? "displayName-error" : null, "displayName-hint"].filter(Boolean).join(" ") ||
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

      {issued ? (
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
            Connect Freight Fate
          </h2>
          <p className="text-slate-800">
            Freight Fate needs two values. In the game, open Online Sharing, then paste your
            Driver ID first and your token second.
          </p>

          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor="ff-token-driver-id">
              Driver ID
            </label>
            <p className="text-sm text-slate-600" id="ff-token-driver-id-hint">
              Paste this into Freight Fate first. It is not secret.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                aria-describedby="ff-token-driver-id-hint"
                autoComplete="off"
                className="w-full rounded border border-line-strong px-3 py-2 font-mono text-ink"
                id="ff-token-driver-id"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                spellCheck={false}
                type="text"
                value={issued.driverId}
              />
              <button
                className={`shrink-0 rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark ${focusRing}`}
                aria-describedby={copyStatus?.area === "issued-driver-id" ? "ff-issued-driver-copy-status" : undefined}
                onClick={() => copyText(issued.driverId, "Driver ID", "issued-driver-id")}
                type="button"
              >
                Copy Driver ID
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-red-800" id="ff-token-desc">
              Your token is shown once. Copy it into Freight Fate on your PC now — you will not be
              able to see it again.
            </p>
            <label className="block font-semibold text-ink" htmlFor="ff-driver-token">
              Driver token
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                aria-describedby="ff-token-desc"
                autoComplete="off"
                className="w-full rounded border border-line-strong px-3 py-2 font-mono text-ink"
                id="ff-driver-token"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                spellCheck={false}
                type="text"
                value={issued.token}
              />
              <button
                className={`shrink-0 rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark ${focusRing}`}
                aria-describedby={copyStatus?.area === "issued-token" ? "ff-issued-token-copy-status" : undefined}
                onClick={() => copyText(issued.token, "Token", "issued-token")}
                type="button"
              >
                Copy token
              </button>
            </div>
          </div>

          {copyStatus?.area === "issued-driver-id" || copyStatus?.area === "issued-token" ? (
            <p
              className={copyStatus.kind === "error" ? "text-sm text-red-700" : "text-sm text-slate-700"}
              id={
                copyStatus.area === "issued-driver-id"
                  ? "ff-issued-driver-copy-status"
                  : "ff-issued-token-copy-status"
              }
            >
              {copyStatus.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {myDriver === undefined ? (
        <Section title="Your driver">
          <p>Loading your driver…</p>
        </Section>
      ) : (
        <Section title={myDriver ? "Your driver" : "Set up your driver"}>
          {myDriver?.needsRename ? (
            <p className="max-w-xl rounded border border-red-300 bg-red-50 p-4 text-slate-800">
              A moderator reset your driver name because it broke the driver naming rules. Choose a
              new name below and save your changes.
            </p>
          ) : null}
          <form
            className="max-w-xl space-y-5 rounded border border-line bg-white p-5"
            noValidate
            onSubmit={handleSubmit}
          >
            <p className="text-slate-800">
              {myDriver
                ? "Update your driver name or profile sharing. Your Driver ID and posting token stay the same unless you rotate the token."
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
                className="w-full rounded border border-line-strong px-3 py-2 text-ink"
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
              {nameError ? (
                <p className="text-sm text-red-700" id="displayName-error">
                  <span aria-hidden="true">⚠ </span>
                  {nameError.message}
                </p>
              ) : null}
              <p className="text-sm text-slate-600" id="displayName-hint">
                3 to 48 characters, including at least three letters. Names must follow the{" "}
                <Link className={focusRing} href="/freight-fate/online/rules">
                  driver naming rules
                </Link>
                . This name appears publicly only while Profile sharing is on.
              </p>
            </div>

            <fieldset className="space-y-4 rounded border border-line-strong p-4">
              <legend className="px-1 font-semibold text-ink">Profile sharing</legend>
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <input
                    aria-describedby="profile-sharing-help"
                    checked={profileSharing}
                    className="mt-1 h-5 w-5 shrink-0"
                    id="profileSharing"
                    name="profileSharing"
                    onChange={(event) => setProfileSharing(event.target.checked)}
                    type="checkbox"
                  />
                  <label className="font-semibold text-ink" htmlFor="profileSharing">
                    Profile sharing
                  </label>
                </div>
                <p className="text-sm text-slate-700" id="profile-sharing-help">
                  When on, eligible driver-profile details, official achievements you earn,
                  road-journal posts generated automatically from gameplay, public-feed updates, and
                  on-duty board activity can appear publicly on orinks.net. When off, all of this is hidden
                  and future public updates stop. orinks.net may retain records privately unless sharing is
                  enabled again. Detailed career statistics appear only after orinks.net accepts and verifies
                  a private Cloud Backup. Cloud Backup is a separate setting in the game and can be on or
                  off independently. The public profile never includes the full backup, money,
                  coordinates, active cargo details, or precise live location.
                  {" "}<Link href="/freight-fate/online/privacy">Read the Freight Fate sharing and privacy details</Link>.
                </p>
              </div>
            </fieldset>

            <button
              aria-describedby={saveError ? "setup-save-error" : undefined}
              aria-disabled={pendingAction !== null || undefined}
              className={`rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
              type="submit"
            >
              {pendingAction === "save"
                ? myDriver
                  ? "Saving…"
                  : "Setting up…"
                : myDriver
                  ? "Save changes"
                  : "Set up driver"}
            </button>
            {saveError ? (
              <p className="text-sm text-red-700" id="setup-save-error">
                {saveError}
              </p>
            ) : null}
          </form>

          {myDriver ? (
            <div className="mt-6 space-y-4 rounded border border-line bg-white p-5">
              <div className="space-y-2">
                <label className="block font-semibold text-ink" htmlFor="ff-driver-id">
                  Driver ID
                </label>
                <p className="text-sm text-slate-600" id="ff-driver-id-hint">
                  Paste this into Freight Fate along with your token. It is not secret.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    aria-describedby="ff-driver-id-hint"
                    autoComplete="off"
                    className="w-full rounded border border-line-strong px-3 py-2 font-mono text-ink"
                    id="ff-driver-id"
                    onFocus={(event) => event.currentTarget.select()}
                    readOnly
                    spellCheck={false}
                    type="text"
                    value={myDriver.driverId}
                  />
                  <button
                    className={`shrink-0 rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 ${focusRing}`}
                    aria-describedby={copyStatus?.area === "driver" ? "ff-driver-copy-status" : undefined}
                    onClick={() => copyText(myDriver.driverId, "Driver ID", "driver")}
                    type="button"
                  >
                    Copy Driver ID
                  </button>
                </div>
                {copyStatus?.area === "driver" ? (
                  <p
                    className={copyStatus.kind === "error" ? "text-sm text-red-700" : "text-sm text-slate-700"}
                    id="ff-driver-copy-status"
                  >
                    {copyStatus.message}
                  </p>
                ) : null}
              </div>

              {!myDriver.sharingEnabled ? (
                <p className="text-slate-700">Profile sharing is off. Your driver profile is private.</p>
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
                  aria-describedby={rotateError ? "rotate-token-error" : undefined}
                  aria-disabled={pendingAction !== null || undefined}
                  className={`rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
                  onClick={handleRotate}
                  type="button"
                >
                  {pendingAction === "rotate" ? "Rotating…" : "Rotate token"}
                </button>
                {rotateError ? (
                  <p className="text-sm text-red-700" id="rotate-token-error">
                    {rotateError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </Section>
      )}
    </>
  );
}
