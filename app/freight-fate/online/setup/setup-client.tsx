"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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

export function shouldAnnounceDriverReady(alreadyAnnounced: boolean, driver: unknown | undefined) {
  return !alreadyAnnounced && driver !== undefined;
}

type PendingAction = "save" | "rotate" | null;

// The one place that explains how a computer actually connects now: no
// values are copied here. Reused verbatim everywhere the page used to point
// at the removed copy-paste panel, so the instruction reads the same way
// every time (a screen reader user should not have to re-parse a reworded
// synonym for the same step) -- which is why this is one function and not a
// sentence each call site assembles for itself.
//
// Only the activate address varies by deployment. The quoted words are the
// game's OWN menu item, and that item is the literal "Set up this computer
// with orinks.net" in every build, including the ones pointed at staging --
// interpolating the host there would name a menu item that does not exist,
// which is unfindable for someone arrowing the menu by its spoken label.
export function connectInstructions(activateHost: string) {
  return (
    'open Freight Fate, choose "Set up this computer with orinks.net," and ' +
    `enter the code it gives you at ${activateHost}/activate`
  );
}

// What the server render and the first client render both say, so hydration
// sees one string; the effect in DriverSetup corrects it to whichever host
// is actually serving the page.
const DEFAULT_ACTIVATE_HOST = "orinks.net";

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
    return TAKEN_ERROR;
  }
  if (data?.code !== "name_rejected") {
    return null;
  }
  return nameRejectionForReason(data.reason as "blocked" | "needs_letters" | undefined);
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
          set up your driver identity, then connect Freight Fate to it from the game.
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

// Owner-facing dates on the computer list. Absolute dates ("July 13, 2026")
// read consistently under a screen reader on a later visit; relative ones
// ("2 days ago") go stale as static text.
function computerDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// One row of the computer list: device tokens plus, for accounts from before
// the list existed, the single legacy token as its own retirable entry.
type ComputerRow = {
  id: string; // device token id, or "legacy"
  label: string;
  createdAt: number | null;
  lastUsedAt: number | null;
  legacy: boolean;
};

function DriverSetup() {
  const { user } = useUser();
  const myDriver = useQuery(api.freightFate.getMyDriver, {});
  const myComputers = useQuery(api.freightFate.getMyComputers, {});
  const provision = useMutation(api.freightFate.provisionDriver);
  const removeComputer = useMutation(api.freightFate.removeComputer);
  const { politeStatus, errorStatus, announcePolite, announceError } = useAnnouncer();

  const [name, setName] = useState("");
  const [profileSharing, setProfileSharing] = useState(false);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [saveError, setSaveError] = useState("");
  const [rotateError, setRotateError] = useState("");
  const [initialized, setInitialized] = useState(false);
  // The same site answers on more than one host: the 1.9 test builds talk to
  // dev.orinks.net, where "enter the code at orinks.net/activate" sends the
  // player to a page their code was never minted on. A plain mount effect,
  // deliberately -- gating it on the driver query would let an announcement
  // beat it and speak the wrong address.
  const [activateHost, setActivateHost] = useState(DEFAULT_ACTIVATE_HOST);
  useEffect(() => {
    setActivateHost(window.location.host);
  }, []);
  const connectHelp = connectInstructions(activateHost);
  const driverReadyAnnounced = useRef(false);
  // Set right before a provision call that mints a brand-new driver (never
  // for an edit of an existing one). The reactive getMyDriver query lags the
  // mutation, so this cannot just check myDriver at focus time — the effect
  // below watches for myDriver to catch up.
  const justCreatedDriverRef = useRef(false);

  // Two-click confirm: the armed button's row id (or "rotate-all"). Never
  // auto-reset on a timer — readers take their time (WCAG 2.2.1); reset on
  // blur or Escape, and announce the reset so a silent disarm cannot trick
  // a returning user into re-arming when they meant to confirm.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [signingOutId, setSigningOutId] = useState<string | null>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const computersHeadingRef = useRef<HTMLHeadingElement>(null);
  // The armed button's spoken label, for the outside-press disarm below.
  const armedLabelRef = useRef("");

  // Safari does not focus buttons on mouse click, so an armed button never
  // blurs there; a document-level press outside the armed button disarms
  // audibly for mouse users too. pointerdown runs before blur, so keyboard
  // users cannot get a double "canceled" announcement.
  useEffect(() => {
    if (armedId === null) {
      return;
    }
    const armedButton = rowButtonRefs.current.get(armedId);
    const onOutsidePress = (event: PointerEvent) => {
      if (!armedButton || !armedButton.contains(event.target as Node)) {
        setArmedId(null);
        announcePolite(`Sign out of ${armedLabelRef.current} canceled.`);
      }
    };
    document.addEventListener("pointerdown", onOutsidePress);
    return () => document.removeEventListener("pointerdown", onOutsidePress);
  }, [armedId, announcePolite]);

  useEffect(() => {
    if (shouldAnnounceDriverReady(driverReadyAnnounced.current, myDriver)) {
      driverReadyAnnounced.current = true;
      announcePolite("Driver settings ready.");
    }
  }, [announcePolite, myDriver]);

  const nameRef = useRef<HTMLInputElement>(null);

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

  // A brand-new driver reveals the computer list for the first time; bring
  // the reader there the moment it mounts. The reactive query
  // can lag the mutation (see justCreatedDriverRef above), so this waits for
  // myDriver itself to become truthy rather than firing right after submit.
  useEffect(() => {
    if (justCreatedDriverRef.current && myDriver) {
      justCreatedDriverRef.current = false;
      computersHeadingRef.current?.focus();
    }
  }, [myDriver]);

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
    // Shared with the activation page's inline name field so the two
    // thresholds cannot drift apart the way two hand-copied checks could.
    const rejection = validateDriverName(trimmed);
    if (rejection) {
      showNameError(rejection);
      return;
    }

    const editing = myDriver != null;
    setNameError(null);
    setSaveError("");
    setPendingAction("save");
    announcePolite(editing ? "Saving changes." : "Setting up your driver.");

    try {
      await provision({
        displayName: trimmed,
        visibility: profileSharing ? "public" : "private",
        expandedSharingConsent: profileSharing,
        rotateToken: false,
        now: Date.now(),
      });
      // Created versus edited is decided by what was on screen when the
      // player pressed Save, not by anything in the response. It used to be
      // read off a minted token, which meant a server that stopped minting
      // silently stopped moving focus to the computer list — a change a
      // sighted reviewer would never notice.
      if (!editing) {
        justCreatedDriverRef.current = true;
        announcePolite(
          `Driver ready. Profile sharing is ${profileSharing ? "on" : "off"}. To connect Freight Fate, ${connectHelp}.`,
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

  // Shared two-click confirm plumbing for every destructive token action:
  // first activation arms the button (its accessible name changes and the
  // change is announced — readers do not re-read a focused button whose text
  // node swapped), the second executes. Blur and Escape disarm audibly.
  function disarm(spokenLabel: string) {
    setArmedId(null);
    announcePolite(`Sign out of ${spokenLabel} canceled.`);
  }

  function armedBlur(id: string, spokenLabel: string) {
    // The row unmounting after a confirmed sign-out also fires blur; that
    // path is a completed action, not a cancel.
    if (armedId === id && signingOutId === null) {
      disarm(spokenLabel);
    }
  }

  function armedKeyDown(event: React.KeyboardEvent, id: string, spokenLabel: string) {
    if (event.key === "Escape" && armedId === id) {
      disarm(spokenLabel);
    }
  }

  async function handleRotateAll() {
    if (pendingAction || !myDriver) {
      return;
    }
    if (armedId !== "rotate-all") {
      setArmedId("rotate-all");
      armedLabelRef.current = "every computer";
      announcePolite("Press again to confirm signing out every computer.");
      return;
    }
    setArmedId(null);
    setRotateError("");
    setPendingAction("rotate");
    announcePolite("Signing out all computers.");
    try {
      // Revokes every token this driver has -- device rows and the legacy
      // single token alike -- and issues none in their place. The driver is
      // left with no connected computers, which is exactly what the
      // announcement below tells the player, and the list re-renders empty
      // to match.
      await provision({
        displayName: myDriver.displayName,
        visibility: myDriver.sharingEnabled ? "public" : "private",
        expandedSharingConsent: myDriver.sharingEnabled,
        rotateToken: true,
        now: Date.now(),
      });
      announcePolite(
        `Done. Every computer is signed out. Each one needs activating again: ${connectHelp}.`,
      );
    } catch {
      const message = "Signing out all computers failed. Nothing changed. Please try again.";
      setRotateError(message);
      announceError(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSignOut(row: ComputerRow, rows: ComputerRow[]) {
    const spokenLabel = row.legacy ? "the original token" : row.label;
    // Arming is always allowed — a silently dead "Sign out" button on the
    // other rows while one sign-out is in flight would be unexplained to a
    // reader. Only the confirm step waits, and it says so.
    if (armedId !== row.id) {
      setArmedId(row.id);
      armedLabelRef.current = spokenLabel;
      announcePolite(`Press again to confirm signing out ${spokenLabel}.`);
      return;
    }
    if (signingOutId !== null) {
      announcePolite("Still signing out another computer. Try again in a moment.");
      return;
    }
    // Pick the focus target before the row unmounts: the next row's button,
    // else the previous one's, else the list heading (focus falling to
    // <body> would throw a reader back to the top of the page).
    const index = rows.findIndex((r) => r.id === row.id);
    const neighbor = rows[index + 1] ?? rows[index - 1] ?? null;
    setArmedId(null);
    setSigningOutId(row.id);
    try {
      await removeComputer({
        tokenId: row.legacy ? "legacy" : (row.id as Id<"freightFateDeviceTokens">),
        now: Date.now(),
      });
      announcePolite(
        row.legacy
          ? "Original token signed out. Any computer still using it will need a new token."
          : `${row.label} signed out. That computer will need a new token to post again.`,
      );
      if (neighbor) {
        rowButtonRefs.current.get(neighbor.id)?.focus();
      } else {
        computersHeadingRef.current?.focus();
      }
    } catch {
      announceError(`Signing out ${spokenLabel} failed. Nothing changed. Please try again.`);
    } finally {
      setSigningOutId(null);
    }
  }

  const nameDescribedBy =
    [nameError ? "displayName-error" : null, "displayName-hint"].filter(Boolean).join(" ") ||
    undefined;

  type MyComputers = typeof myComputers;

  function ComputerList(props: {
    armedId: string | null;
    computersHeadingRef: React.RefObject<HTMLHeadingElement | null>;
    // Passed in, not computed here: this function must stay hook-free (see
    // the call site), and the host it depends on lives in DriverSetup state.
    connectHelp: string;
    myComputers: MyComputers;
    onArmedBlur: (id: string, spokenLabel: string) => void;
    onArmedKeyDown: (event: React.KeyboardEvent, id: string, spokenLabel: string) => void;
    onRotateAll: () => void;
    onSignOut: (row: ComputerRow, rows: ComputerRow[]) => void;
    rotateError: string;
    rotatePending: boolean;
    rowButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement | null>>;
    signingOutId: string | null;
  }) {
    const computers = props.myComputers;
    const rows: ComputerRow[] =
      computers == null
        ? []
        : [
            ...computers.computers.map((computer) => ({
              id: computer.id as string,
              label: computer.label,
              createdAt: computer.createdAt,
              lastUsedAt: computer.lastUsedAt,
              legacy: false,
            })),
            ...(computers.hasLegacyToken
              ? [
                  {
                    id: "legacy",
                    label: "Original token (from before this computer list)",
                    createdAt: null,
                    lastUsedAt: null,
                    legacy: true,
                  },
                ]
              : []),
          ];

    return (
      <div className="space-y-3">
        <h3
          className={`text-lg font-bold text-ink ${focusRing}`}
          id="ff-computers-heading"
          ref={props.computersHeadingRef}
          tabIndex={-1}
        >
          Your computers
        </h3>
        <p className="text-sm text-slate-700">
          Each computer you play on gets its own token. Connecting a new one never signs out the
          others, so your desktop keeps working when you set up a laptop.
        </p>

        {computers === undefined ? (
          <p className="text-slate-700">Loading your computers…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-700">No computers are connected yet.</p>
        ) : (
          // Tailwind's list-style reset strips list semantics in some
          // readers; the explicit role keeps "list, N items" announced.
          <ul className="space-y-3" role="list">
            {rows.map((row) => {
              const spokenLabel = row.legacy ? "the original token" : row.label;
              const armed = props.armedId === row.id;
              const busy = props.signingOutId === row.id;
              return (
                <li
                  className="flex flex-col gap-2 rounded border border-line p-3 sm:flex-row sm:items-center sm:justify-between"
                  key={row.id}
                >
                  <div>
                    <span className="font-semibold text-ink">{row.label}</span>
                    <p className="text-sm text-slate-600">
                      {row.createdAt !== null ? `Added ${computerDate(row.createdAt)}. ` : ""}
                      {row.legacy
                        ? "Still works anywhere it was pasted; sign it out once every computer has its own token."
                        : row.lastUsedAt !== null
                          ? `Last played ${computerDate(row.lastUsedAt)}.`
                          : "Not used yet."}
                    </p>
                  </div>
                  <button
                    aria-disabled={busy || undefined}
                    aria-label={
                      busy
                        ? `Signing out ${spokenLabel}`
                        : armed
                          ? `Confirm sign out of ${spokenLabel}`
                          : `Sign out ${spokenLabel}`
                    }
                    className={`shrink-0 rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
                    onBlur={() => props.onArmedBlur(row.id, spokenLabel)}
                    onClick={() => props.onSignOut(row, rows)}
                    onKeyDown={(event) => props.onArmedKeyDown(event, row.id, spokenLabel)}
                    ref={(element) => {
                      props.rowButtonRefs.current.set(row.id, element);
                    }}
                    type="button"
                  >
                    {busy ? "Signing out…" : armed ? "Confirm sign out" : "Sign out"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-sm text-slate-700">
          To add a computer, {props.connectHelp}.
        </p>

        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-slate-600">
            If a token may have leaked, sign out everything at once: every computer stops posting,
            and each one — including this one — will need activating again.
          </p>
          <button
            aria-describedby={props.rotateError ? "rotate-token-error" : undefined}
            aria-disabled={props.rotatePending || undefined}
            className={`rounded border border-line px-4 py-2 font-semibold text-ink hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
            onBlur={() => props.onArmedBlur("rotate-all", "every computer")}
            onClick={props.onRotateAll}
            onKeyDown={(event) => props.onArmedKeyDown(event, "rotate-all", "every computer")}
            ref={(element) => {
              // Registered under its armed id so the outside-press disarm
              // can tell presses on this button from presses elsewhere.
              props.rowButtonRefs.current.set("rotate-all", element);
            }}
            type="button"
          >
            {props.rotatePending
              ? "Signing out…"
              : props.armedId === "rotate-all"
                ? "Confirm: sign out all computers"
                : "Sign out all computers"}
          </button>
          {props.rotateError ? (
            <p className="text-sm text-red-700" id="rotate-token-error">
              {props.rotateError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Always mounted so announcements are never missed. */}
      <div aria-atomic="true" className="sr-only" role="status">
        {politeStatus}
      </div>
      <div aria-atomic="true" className="sr-only" role="alert">
        {errorStatus}
      </div>

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
                ? "Update your driver name or profile sharing. Tokens for each of your computers are managed below."
                : `Create your driver identity. Then, to connect Freight Fate to it, ${connectHelp}.`}
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
                {NAME_HINT_PREFIX}{" "}
                <Link className={focusRing} href={NAME_RULES_HREF}>
                  {NAME_RULES_LINK_TEXT}
                </Link>
                {NAME_HINT_SUFFIX}
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
                  Shows your driver profile, board status, road-journal posts, and achievements on
                  orinks.net. Career statistics come from an accepted Cloud Backup. Turning it off removes
                  them from public pages. {" "}
                  <Link href="/freight-fate/online/privacy">Profile sharing and Cloud Backup details</Link>.
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
              {!myDriver.sharingEnabled ? (
                <p className="text-slate-700">Profile sharing is off.</p>
              ) : (
                <p>
                  <Link href={`/freight-fate/drivers/${myDriver.driverId}`}>
                    View your public driver profile
                  </Link>
                  .
                </p>
              )}

              {/* Called directly (not as a JSX element): a component defined
                  inside DriverSetup would remount every render, tearing down
                  rowButtonRefs and dropping keyboard focus out of an armed
                  "Confirm sign out" button mid-interaction. Must remain
                  hook-free — this is a conditional direct call, and
                  rules-of-hooks lint cannot see into it. */}
              {ComputerList({
                armedId,
                computersHeadingRef,
                connectHelp,
                myComputers,
                onArmedBlur: armedBlur,
                onArmedKeyDown: armedKeyDown,
                onRotateAll: handleRotateAll,
                onSignOut: handleSignOut,
                rotateError,
                rotatePending: pendingAction === "rotate",
                rowButtonRefs,
                signingOutId,
              })}
            </div>
          ) : null}
        </Section>
      )}
    </>
  );
}
