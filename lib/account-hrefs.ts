/**
 * Paths for the site's Clerk sign-in and sign-up pages.
 *
 * Clerk's prebuilt SignIn (clerk-js 6 / @clerk/ui 1, as used by @clerk/nextjs
 * v7) has no `/sign-in/forgot-password` route. "Forgot password?" lives on
 * the start form at `/sign-in`, then continues at `/sign-in/factor-one` (with
 * `__clerk_reset_password=true`) and `/sign-in/reset-password`.
 */
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

function isAccountPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return [SIGN_IN_PATH, SIGN_UP_PATH].some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

// currentPath may carry a query string (/activate?code=...), which has to
// survive the round trip. Neither account page is ever a return target:
// signing in from /sign-up would bounce back to /sign-up.
function withRedirect(target: string, currentPath: string | null | undefined): string {
  if (!currentPath || isAccountPath(currentPath)) {
    return target;
  }
  return `${target}?redirect_url=${encodeURIComponent(currentPath)}`;
}

export function signInHref(currentPath: string | null | undefined): string {
  return withRedirect(SIGN_IN_PATH, currentPath);
}

export function signUpHref(currentPath: string | null | undefined): string {
  return withRedirect(SIGN_UP_PATH, currentPath);
}
