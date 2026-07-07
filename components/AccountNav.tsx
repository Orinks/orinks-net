"use client";

import { Show, SignInButton, SignOutButton, SignUpButton, useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

// Matches the Projects/Games/Game Mods disclosures in Header.tsx.
const summaryClass =
  "inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-600 [&::-webkit-details-marker]:hidden";
const itemClass =
  "inline-flex min-h-10 w-full items-center rounded-md px-3 py-2 text-left font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-600";

/**
 * "Account" disclosure for the primary nav — the header's account entry
 * point. Signed out it offers sign in / create account (Clerk modals);
 * signed in the summary carries the username and the panel offers manage
 * account / sign out. Native details/summary on purpose: it matches the
 * other nav disclosures and announces honest expanded/collapsed state
 * (accessibility-lead reviewed; no ARIA menu roles).
 */
export function AccountNav() {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // Both auth transitions unmount the panel item that held focus (sign-in:
  // the modal trigger; sign-out: the "Sign out" button), which would drop
  // focus to <body> and make a screen reader restart at the top of the
  // page. Close the disclosure and move focus to the persistent summary —
  // whose label just changed, giving implicit confirmation of the new
  // state. The activeElement guard keeps cross-tab auth syncs from
  // yanking focus while the user is reading elsewhere; the undefined init
  // step keeps the initial cookie-restored sign-in from stealing focus on
  // page load.
  const wasSignedIn = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (wasSignedIn.current === undefined) {
      wasSignedIn.current = isSignedIn;
      return;
    }
    if (isSignedIn !== wasSignedIn.current) {
      const active = document.activeElement;
      const focusWasLost =
        active === document.body || (detailsRef.current?.contains(active) ?? false);
      if (detailsRef.current) {
        detailsRef.current.open = false;
      }
      if (focusWasLost || isSignedIn) {
        summaryRef.current?.focus();
      }
    }
    wasSignedIn.current = isSignedIn;
  }, [isLoaded, isSignedIn]);

  const label = isSignedIn
    ? (user?.username ?? user?.fullName ?? user?.firstName ?? "My account")
    : "Account";

  return (
    <details className="group rounded-md" ref={detailsRef}>
      <summary className={summaryClass} ref={summaryRef}>
        <span>
          {isSignedIn ? <span className="sr-only">Account, signed in as </span> : null}
          {label}
        </span>
        <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
          ▼
        </span>
      </summary>
      <div className="mt-2 flex min-w-52 flex-col rounded-md border border-line bg-white p-2 shadow-sm">
        {!isLoaded ? (
          <p className="px-3 py-2 text-sm text-slate-600">Loading account…</p>
        ) : (
          <>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className={itemClass} type="button">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className={itemClass} type="button">
                  Create account
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <button className={itemClass} onClick={() => clerk.openUserProfile()} type="button">
                Manage account
              </button>
              <SignOutButton>
                <button className={itemClass} type="button">
                  Sign out
                </button>
              </SignOutButton>
            </Show>
          </>
        )}
      </div>
    </details>
  );
}
