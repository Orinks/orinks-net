import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk is client-only on this site: no page or API route calls `auth()` on
// the server, and every page stays publicly reachable. Sign-in state comes
// from the Clerk browser SDK through ClerkProvider, which does not need this
// middleware.
//
// It runs only on the account pages, where it keeps the session cookie fresh
// on a full page load. It must not run site-wide: Clerk adds request headers
// to every response it touches, and the Worker treats any middleware request
// header override as uncacheable. Site-wide, that turned every page into a
// per-request render with `private, no-store` and skipped the ISR cache, even
// pages marked static or `revalidate`.
//
// A route that ever needs `auth()` on the server has to be added here.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/activate/:path*",
    "/games/connect/:path*",
    "/freight-fate/online/setup/:path*",
    "/freight-fate/suggest-a-station/:path*",
  ],
};
