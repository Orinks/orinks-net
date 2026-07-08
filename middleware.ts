import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches Clerk auth context site-wide. It does NOT protect any routes on its
// own — every page stays publicly reachable; it just makes the session
// available to components that ask for it. Static assets are excluded.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
