import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches Clerk auth context site-wide. It does NOT protect any routes on its
// own — every page stays publicly reachable; it just makes the session
// available to components that ask for it. Static assets are excluded.
//
// The extension list must cover every static file type served from public/,
// not just the web-page ones. Nothing reads auth on a media request, so an
// extension missing here buys nothing and costs a session check — and the
// Midnight Signal host alone is 800+ clips, replayed all run long.
//
// /api is excluded too. Clerk is client-only here: nothing under app/api reads
// a Clerk session, and the game endpoints authenticate with their own bearer
// tokens, so running the session check on a route the desktop client polls is
// pure cost. An API route that ever needs `auth()` has to be added back.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|api(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|avif|png|gif|svg|ico|ttf|woff2?|otf|eot|csv|docx?|xlsx?|pdf|txt|xml|zip|7z|gz|tar|rar|exe|msi|dmg|apk|mp3|wav|ogg|opus|m4a|aac|flac|mp4|webm|mov|webmanifest)).*)",
  ],
};
