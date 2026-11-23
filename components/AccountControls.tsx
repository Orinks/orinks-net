"use client";

import { Show, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import type { ComponentProps } from "react";
import { forgotPasswordHref, signInHref, signUpHref } from "@/lib/account-hrefs";
import { useReturnPath } from "@/lib/use-return-path";
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

// not-prose: most hosts sit inside <Section>, whose `.prose a` colour would
// otherwise paint the Sign in label the same blue as its background.
const defaultSignIn =
  "not-prose inline-flex min-h-10 items-center rounded-md bg-action px-3 py-2 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2";
const defaultSignUp =
  "not-prose inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-600";
const defaultForgot =
  "not-prose inline-flex min-h-10 items-center rounded-md px-3 py-2 font-semibold text-action underline hover:text-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600";

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
  // Sign-in happens on its own page, and the redirect back lands on this
  // page's heading (RouteFocusManager), so there is no focus to manage here.
  const { user } = useUser();
  const returnPath = useReturnPath();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Show when="signed-out">
        <Link className={signInClassName ?? defaultSignIn} href={signInHref(returnPath)}>
          Sign in
        </Link>
        <Link className={signUpClassName ?? defaultSignUp} href={signUpHref(returnPath)}>
          Create account
        </Link>
        <Link className={forgotClassName ?? defaultForgot} href={forgotPasswordHref(returnPath)}>
          Forgot password?
        </Link>
      </Show>
      <Show when="signed-in">
        <span className={nameClassName ?? "text-sm font-semibold text-slate-700"}>
          <span className="sr-only">Signed in as </span>
          {userDisplayName(user, "your account")}
        </span>
        <UserButton appearance={userButtonAppearance} />
      </Show>
    </div>
  );
}
