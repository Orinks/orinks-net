import { bindings, defineConfig, defineWorker } from "cf/config";

// Runtime configuration for the Worker. Only names declared under `env` reach
// the Worker (as `env.X` and, with nodejs_compat, as `process.env.X`).
//
// NEXT_PUBLIC_* values are NOT read here: they are inlined into the bundle at
// build time, so they must be present in the build environment instead (see
// CLOUDFLARE.md).
//
// Secrets are declared without a value. Locally they come from .dev.vars;
// in a deployed Worker they are set with `cf workers secrets put NAME` /
// `wrangler secret put NAME` (or the dashboard). A declared secret that is
// missing only produces a warning.
//
// Two targets, picked with the Vite/cf mode:
//
//   --mode preview     -> Worker "orinks-net-preview" on workers.dev.
//                         Not indexed (robots.txt disallows everything) and
//                         counts visits under its own "cloudflare-preview"
//                         key, never the production counter.
//   --mode production  -> Worker "orinks-net", the real site. This is what
//                         orinks.net is attached to at cutover.
//
// Any other mode (including `vite dev`'s "development") is treated as a
// non-production preview so nothing outside the explicit production deploy
// can claim the production counter or be indexed.
export default defineConfig(({ mode }) => {
  const production = mode === "production";
  // Secrets only the production Worker requires. The preview leaves them
  // out on purpose: without RESEND_API_KEY it cannot send contact email,
  // without VAPID_PRIVATE_KEY / BUILD_NOTIFICATION_TOKEN it cannot send push
  // notifications, and the GitHub / Last.fm / Spotify panels fall back to
  // their signed-out or empty states. (A secret set later in the dashboard
  // still reaches the Worker; declaring it here only makes deploys insist
  // on it.)
  const productionSecret = () => (production ? bindings.secret() : undefined);

  return {
    worker: defineWorker({
      name: production ? "orinks-net" : "orinks-net-preview",
      entrypoint: "vinext/server/fetch-handler",
      // Keep this at or below the date the installed workerd supports.
      compatibilityDate: "2026-10-23",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: true,
      // No per-version preview URLs: each would be one more public copy of
      // the site for crawlers to find.
      previewUrls: false,
      observability: { enabled: true },
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
      },
      env: {
        ASSETS: bindings.assets(),
        // Backs unstable_cache / ISR (vinext's KV data cache).
        VINEXT_KV_CACHE: bindings.kv(),

        // Plain, non-secret runtime values.
        // The site reads VERCEL_ENV for robots.txt (only "production" is
        // indexed) and the visit counter's bucket.
        VERCEL_ENV: bindings.text(production ? "production" : "preview"),
        VISITOR_COUNTER_ENV: bindings.text(production ? "production" : "cloudflare-preview"),
        MASTODON_PROFILE_URL: bindings.text("https://mastodon.stickbear.me/@Orinks/"),
        VAPID_SUBJECT: bindings.text("mailto:notifications@orinks.net"),
        CONTACT_FROM_EMAIL: bindings.text("orinks.net contact <contact@orinks.net>"),
        CONTACT_TO_EMAIL: bindings.text("orin8722@gmail.com"),
        // Public Vercel Blob URL of the Freight Fate music pack
        // (/downloads/music.pak redirects to it).
        FREIGHT_FATE_MUSIC_BLOB_URL: bindings.secret(),

        // Secrets every Worker needs.
        CONVEX_URL: bindings.secret(),
        CLERK_SECRET_KEY: bindings.secret(),
        GITHUB_TOKEN: productionSecret(),
        LASTFM_API_KEY: productionSecret(),
        LASTFM_USERNAME: productionSecret(),
        SPOTIFY_CLIENT_ID: productionSecret(),
        SPOTIFY_CLIENT_SECRET: productionSecret(),
        SPOTIFY_REFRESH_TOKEN: productionSecret(),
        SPOTIFY_REDIRECT_URI: productionSecret(),
        SPOTIFY_LOGIN_KEY: productionSecret(),
        VAPID_PRIVATE_KEY: productionSecret(),
        RESEND_API_KEY: productionSecret(),
        // GAMES_SERVER_SECRET is read by lib/games/stores.ts but is not set
        // on Vercel either (no game is registered yet), so it is not required
        // here. Set it with `cf workers secrets put` when a game goes live.
        BUILD_NOTIFICATION_TOKEN: productionSecret(),
      },
    }),
  };
});
