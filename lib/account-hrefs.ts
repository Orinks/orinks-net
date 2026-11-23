/**
 * Paths for the site's Clerk account pages.
 *
 * Password reset for a signed-out user is the /forgot-password page, which
 * uses Clerk's custom resetPasswordEmailCode flow. The prebuilt SignIn
 * card can still start a reset from /sign-in after an identifier is entered.
 */
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";
export const FORGOT_PASSWORD_PATH = "/forgot-password";

const ACCOUNT_PATHS = [SIGN_IN_PATH, SIGN_UP_PATH, FORGOT_PASSWORD_PATH];

function pathnameOf(path: string): string {
  return path.split(/[?#]/)[0];
}

function isAccountPath(path: string): boolean {
  const pathname = pathnameOf(path);
  return ACCOUNT_PATHS.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/**
 * Only same-origin relative paths, so a redirect_url cannot send the
 * browser off the site.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

function redirectFrom(currentPath: string): string | null {
  const query = currentPath.includes("?") ? currentPath.slice(currentPath.indexOf("?") + 1).split("#")[0] : "";
  return safeReturnPath(new URLSearchParams(query).get("redirect_url"));
}

// currentPath may carry a query string (/activate?code=...), which has to
// survive the round trip. Account pages are never themselves a return
// target, but if one already has a redirect_url, keep it when moving
// between Sign in, Create account, and Forgot password.
function withRedirect(target: string, currentPath: string | null | undefined): string {
  if (!currentPath) {
    return target;
  }
  const dest = isAccountPath(currentPath) ? redirectFrom(currentPath) : safeReturnPath(currentPath);
  if (!dest) {
    return target;
  }
  return `${target}?redirect_url=${encodeURIComponent(dest)}`;
}

export function redirectUrlFrom(currentPath: string | null | undefined, fallback = "/"): string {
  if (!currentPath) {
    return fallback;
  }
  const dest = isAccountPath(currentPath) ? redirectFrom(currentPath) : safeReturnPath(currentPath);
  return dest ?? fallback;
}

export function signInHref(currentPath: string | null | undefined): string {
  return withRedirect(SIGN_IN_PATH, currentPath);
}

export function signUpHref(currentPath: string | null | undefined): string {
  return withRedirect(SIGN_UP_PATH, currentPath);
}

export function forgotPasswordHref(currentPath: string | null | undefined): string {
  return withRedirect(FORGOT_PASSWORD_PATH, currentPath);
}
