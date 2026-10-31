import { bindings, defineConfig, defineWorker } from "cf/config";

// Runtime configuration for the Worker. Only names declared under `env` reach
// the Worker (as `env.X` and, with nodejs_compat, as `process.env.X`).
//
// NEXT_PUBLIC_* values are NOT read here: they are inlined into the bundle at
// build time, so they must be present in the build environment instead (see
// CLOUDFLARE.md).
//
// Secrets are declared without a value. Locally they come from .dev.vars;
// in a deployed Worker they are set with `wrangler secret put NAME` (or the
// dashboard). A declared secret that is missing only produces a warning.
export default defineConfig({
  worker: defineWorker({
    name: "orinks-net",
    entrypoint: "vinext/server/fetch-handler",
    // Keep this at or below the date the installed workerd supports.
    compatibilityDate: "2026-10-23",
    compatibilityFlags: ["nodejs_compat"],
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
      // indexed) and the visit counter's bucket. "preview" keeps a test
      // Worker out of search; set it to "production" only for orinks.net.
      VERCEL_ENV: bindings.text("preview"),
      MASTODON_PROFILE_URL: bindings.text("https://mastodon.stickbear.me/@Orinks/"),
      VAPID_SUBJECT: bindings.text("mailto:notifications@orinks.net"),
      CONTACT_FROM_EMAIL: bindings.text("orinks.net contact <contact@orinks.net>"),
      CONTACT_TO_EMAIL: bindings.text("orin8722@gmail.com"),

      // Per-environment values and secrets.
      CONVEX_URL: bindings.secret(),
      VISITOR_COUNTER_ENV: bindings.secret(),
      CLERK_SECRET_KEY: bindings.secret(),
      GITHUB_TOKEN: bindings.secret(),
      LASTFM_API_KEY: bindings.secret(),
      LASTFM_USERNAME: bindings.secret(),
      SPOTIFY_CLIENT_ID: bindings.secret(),
      SPOTIFY_CLIENT_SECRET: bindings.secret(),
      SPOTIFY_REFRESH_TOKEN: bindings.secret(),
      SPOTIFY_REDIRECT_URI: bindings.secret(),
      SPOTIFY_LOGIN_KEY: bindings.secret(),
      VAPID_PRIVATE_KEY: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      GAMES_SERVER_SECRET: bindings.secret(),
      BUILD_NOTIFICATION_TOKEN: bindings.secret(),
    },
  }),
});
