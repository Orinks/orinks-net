"use client";

import { Show, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { signInHref, signUpHref } from "@/lib/account-hrefs";
import { userDisplayName } from "@/lib/user-name";

type AccountControlsProps = {
  /** Overrides so dark-themed contexts (Midnight Signal) can restyle the links. */
  signInClassName?: string;
  signUpClassName?: string;
  forgotClassName?: string;
  /** Class for the signed-in username text. Dark themes MUST override this. */
  nameClassName?: string;
  /** Clerk appearance for the UserButton popup (e.g. baseTheme: dark). */
  userButtonAppearance?: ComponentProps<typeof UserButton>["appearance"];
};

const defaultSignIn =
  "inline-flex min-h-10 items-center rounded-md bg-action px-3 py-2 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2";
const defaultSignUp =
  "inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-600";
const defaultForgot =
  "inline-flex min-h-10 items-center rounded-md px-3 py-2 font-semibold text-action underline hover:text-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600";

/**
 * The site's single shared account flow (Clerk): links to the sign-in and
 * create-account pages when signed out, username + account menu when signed
 * in. Used on game pages so the flow is never duplicated.
 */
export function AccountControls({
  signInClassName,
  signUpClassName,
  forgotClassName,
  nameClassName,
  userButtonAppearance,
}: AccountControlsProps) {
  const { user, isLoaded, isSignedIn } = useUser();
  const pathname = usePathname();

  // When sign-in completes on this page (for example after a redirect back,
  // or a sign-in in another tab), the signed-out links unmount, so focus
  // would drop to <body> and a screen reader restarts at the top of the page.
  // Move focus to the signed-in name instead. The undefined init step keeps
  // a cookie-restored session from stealing focus on first load.
  const signedInRef = useRef<HTMLSpanElement>(null);
  const wasSignedIn = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (wasSignedIn.current === undefined) {
      wasSignedIn.current = isSignedIn;
      return;
    }
    if (isSignedIn === true && wasSignedIn.current === false) {
      signedInRef.current?.focus();
    }
    wasSignedIn.current = isSignedIn;
  }, [isLoaded, isSignedIn]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Show when="signed-out">
        <Link className={signInClassName ?? defaultSignIn} href={signInHref(pathname)}>
          Sign in
        </Link>
        <Link className={signUpClassName ?? defaultSignUp} href={signUpHref(pathname)}>
          Create account
        </Link>
        <Link className={forgotClassName ?? defaultForgot} href={signInHref(pathname)}>
          Forgot password?
        </Link>
      </Show>
      <Show when="signed-in">
        <span
          className={nameClassName ?? "text-sm font-semibold text-slate-700"}
          ref={signedInRef}
          tabIndex={-1}
        >
          <span className="sr-only">Signed in as </span>
          {userDisplayName(user, "your account")}
        </span>
        <UserButton appearance={userButtonAppearance} />
      </Show>
    </div>
  );
}
