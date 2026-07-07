"use client";

import { Show, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useRef, type ComponentProps } from "react";

type AccountControlsProps = {
  /** Overrides so dark-themed contexts (Midnight Signal) can restyle the buttons. */
  signInClassName?: string;
  signUpClassName?: string;
  /** Class for the signed-in username text. Dark themes MUST override this. */
  nameClassName?: string;
  /** Clerk appearance for the UserButton popup (e.g. baseTheme: dark). */
  userButtonAppearance?: ComponentProps<typeof UserButton>["appearance"];
};

const defaultSignIn =
  "inline-flex min-h-10 items-center rounded-md bg-action px-3 py-2 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2";
const defaultSignUp =
  "inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-600";

/**
 * The site's single shared account flow (Clerk): sign in / create account
 * when signed out, username + account menu when signed in. Used by the site
 * header and reused by both games so the flow is never duplicated.
 */
export function AccountControls({
  signInClassName,
  signUpClassName,
  nameClassName,
  userButtonAppearance,
}: AccountControlsProps) {
  const { user, isSignedIn } = useUser();

  // When the Clerk modal completes sign-in, the trigger button unmounts with
  // the signed-out branch, so focus would drop to <body> and a screen reader
  // restarts at the top of the page. Move focus to the signed-in name instead
  // (accessibility-lead review requirement; mirrors GameApp's wasSignedIn ref).
  const signedInRef = useRef<HTMLSpanElement>(null);
  const wasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    if (isSignedIn === true && wasSignedIn.current === false) {
      signedInRef.current?.focus();
    }
    wasSignedIn.current = isSignedIn;
  }, [isSignedIn]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className={signInClassName ?? defaultSignIn} type="button">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className={signUpClassName ?? defaultSignUp} type="button">
            Create account
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <span
          className={nameClassName ?? "text-sm font-semibold text-slate-700"}
          ref={signedInRef}
          tabIndex={-1}
        >
          <span className="sr-only">Signed in as </span>
          {user?.username ?? user?.fullName ?? user?.firstName ?? "Signed in"}
        </span>
        <UserButton appearance={userButtonAppearance} />
      </Show>
    </div>
  );
}
