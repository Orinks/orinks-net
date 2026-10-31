# Cloudflare Workers test build

This branch runs the site's frontend on Cloudflare Workers with
[vinext](https://github.com/cloudflare/vinext), Cloudflare's recommended Next.js
adapter. Convex and Clerk are unchanged. `next dev` / `next build` and the
Vercel build keep working as before; the Workers build sits alongside them.

Nothing here is deployed. It has only been run locally in the Workers runtime
(workerd).

## Commands

| Command | What it does |
| --- | --- |
| `npm run build:vinext` | Builds the Worker into `.cloudflare/output/` and `dist/` (both gitignored). It also rewrites `next-env.d.ts`; do not commit that change (`vinext-env.d.ts` carries vinext's types). |
| `npm run start:vinext` | Serves that build in workerd on http://localhost:4173 (`vite preview`). |
| `npm run dev:vinext` | Vite dev server in workerd, with hot reload. |
| `npm run deploy:vinext` | Deploys to Cloudflare. Needs a Cloudflare login or API token. Not run. |

## Environment variables: build time vs run time

Cloudflare keeps the two apart, and so does this build.

**Build time (inlined into the bundle).** Every `NEXT_PUBLIC_*` value is
replaced with its literal value when `build:vinext` runs, in both the browser
bundle and the Worker. Set them in the build environment (the shell, a `.env`
file, or Workers Builds' *build variables*), not as Worker vars:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

`next.config.ts` also reads `CONVEX_URL`/`NEXT_PUBLIC_CONVEX_URL` at build time
to set up the presence rewrite to `<deployment>.convex.site`.

Changing any of these means rebuilding, not just editing a Worker variable.

**Run time (Worker bindings).** Server code reads `process.env.X` at request
time. On Workers that only works for names declared under `env` in
`cloudflare.config.ts` (with `nodejs_compat`, declared vars and secrets are
copied onto `process.env`). An undeclared name is simply `undefined`.

- Plain values are declared with `bindings.text(...)` in the config:
  `VERCEL_ENV`, `MASTODON_PROFILE_URL`, `VAPID_SUBJECT`, `CONTACT_FROM_EMAIL`,
  `CONTACT_TO_EMAIL`.
- Secrets and per-environment values are declared with `bindings.secret()`:
  `CONVEX_URL`, `VISITOR_COUNTER_ENV`, `CLERK_SECRET_KEY`, `GITHUB_TOKEN`,
  `LASTFM_API_KEY`, `LASTFM_USERNAME`, `SPOTIFY_*`, `VAPID_PRIVATE_KEY`,
  `RESEND_API_KEY`, `GAMES_SERVER_SECRET`, `BUILD_NOTIFICATION_TOKEN`.
  Locally they come from `.dev.vars` (copy `.dev.vars.example`). On Cloudflare
  they are set with `wrangler secret put NAME` or in the dashboard.

Vercel-only variables: `VERCEL_ENV` is declared as `"preview"` here so a test
Worker is not indexed (`app/robots.ts`) and counts visits in its own bucket.
`VERCEL_GIT_COMMIT_REF` does not exist on Workers; set `VISITOR_COUNTER_ENV`
instead. The Convex deploy key stays a CI secret; it is never a Worker value.

## Code changes needed for Workers

- `vite.config.ts`, `cloudflare.config.ts` (new): the vinext and Cloudflare
  plugin setup. `unstable_cache` and ISR use a KV namespace
  (`VINEXT_KV_CACHE`). `compatibilityDate` must not be newer than the installed
  workerd supports.
- `package.json`: `"type": "module"`, the vinext scripts and dependencies, and
  React 19.3.1 (vinext's minimum). `postcss.config.js` became
  `postcss.config.cjs` because of `"type": "module"`.
- `app/api/freight-fate/stations/preview/route.ts`: on Workers, `node:tls`
  checks the certificate against the host it dials and ignores `servername`.
  Dialing the resolved IP failed every https stream ("certificate not valid
  for name <ip>"). On Workers the hostname is dialed instead. Plain-http
  streams and the private-address refusal already worked.
- `lib/client-ip.ts` (new), used by the contact form, game activation and the
  games service. On Cloudflare the first `X-Forwarded-For` entry is whatever
  the client sent, so on Workers the address comes from `CF-Connecting-IP`.
  Vercel behaviour is unchanged.

## Vercel features in use and how they map

| On Vercel | On Workers |
| --- | --- |
| `vercel.json` build (Convex deploy, then build) and ignore step | Needs Workers Builds or a GitHub Action that runs `npx convex deploy --cmd "npm run build:vinext"` then deploys. Not set up. |
| ISR (`revalidate` on 7 pages) and `unstable_cache` / `revalidateTag` | vinext's KV data cache (`VINEXT_KV_CACHE`). Works locally. Pages are still rendered per request unless a CDN cache mode (`--cdn-cache=response-store` or `workers-cache`) is added. |
| `vercel-cdn-cache-control` headers (visits, presence, current conditions) | Ignored by Cloudflare. Use `Cache-Control: s-maxage` or `CDN-Cache-Control` with a cache mode, or the Workers Cache API. |
| `middleware.ts` (Clerk) | Supported. Clerk's middleware runs and verifies session cookies. |
| `next/image` (one use, the header avatar from github.com) | Served as is, no resizing, unless an optimizer (Cloudflare Images) is configured. |
| Rewrite of the game's presence POST to Convex | Works, but the Worker proxies it, so it is a Worker request, unlike Vercel's edge rewrite. |
| Redirects, headers | Work (`/_headers` for the trivia audio cache rule). |
| `runtime = "nodejs"`, `maxDuration` | Ignored. Everything runs in workerd with `nodejs_compat`. No wall-clock limit while the client is connected; CPU time is what is limited. |
| `@vercel/blob` (dev script only), Vercel Cron, Edge Config | Not used at run time. |
| Static files in `public/` (856 files, 293 MB) | Workers static assets: within 20,000 files, every file under 25 MiB. Served without running the Worker. |

## CPU time per request (free plan: 10 ms)

Measured on the local Workers runtime (workerd 1.20261023, production build,
inspector off) as the workerd process's CPU time over 30 warm requests per
path, after 3 warm-up requests. The figure includes workerd's own HTTP and TLS
work, so it is an upper bound on what Cloudflare would bill. A trivial route
(`/robots.txt`) costs 3.4 ms, which is roughly that floor.

| Path | CPU per request |
| --- | --- |
| `/` | 45.7 ms |
| `/whats-new` | 47.4 ms |
| `/freight-fate/user-manual` | 25.5 ms |
| `/freight-fate` | 20.4 ms |
| `/freight-fate/drivers` (drivers board) | 18.4 ms |
| `/freight-fate/drivers/<id>/achievements` | 18.2 ms |
| `/freight-fate/drivers/<id>` | 16.5 ms |
| `/freight-fate/updates` | 15.8 ms |
| `/playlists` | 11.6 ms |
| `/freight-fate/review-stations` | 10.5 ms |
| `/accessiweather` | 9.9 ms |
| `/contact` | 9.5 ms |
| `/api/current-conditions` | 11.9 ms |
| `/api/freight-fate/stations` | 6.3 ms |
| `/whats-new/feed.xml` | 6.0 ms |
| `/api/freight-fate/directory` | 5.4 ms |
| `/api/visits` (GET) | 5.2 ms |
| `/api/health` | 4.7 ms |
| `/api/freight-fate/drivers/<id>` | 4.5 ms |
| `/api/freight-fate/presence` (GET) | 4.2 ms |
| `/robots.txt` | 3.4 ms |

Every server-rendered page is at or over 10 ms, most of them well over, so the
free plan would fail them with "Exceeded CPU limit". The API routes fit. The
Workers Paid plan ($5 a month) allows 30 s of CPU per request by default and
includes 30 million CPU-ms a month: about 850,000 requests at an average of
15 ms is about 13 million, inside the allowance.

KV, which backs `unstable_cache`, also points at Paid: the free plan allows
1,000 KV writes a day, and the drivers board snapshot alone refreshes every 60
seconds (up to 1,440 writes a day) before the directory, profiles and GitHub
lookups. Paid includes 1 million writes a month.

## Bundle size

The Worker (server code, without source maps) is 4.0 MB uncompressed and about
1.2 MB gzip-compressed, under the free plan's 3 MB and the paid plan's 10 MB
compressed limits. The largest pieces are client-only libraries pulled into the
server render (`hls.js` 574 KB, `ableplayer` 401 KB), which could be loaded
only in the browser to trim it.

## Not yet working or not tested

- `/api/games/[game]/[...path]` reads `.wasm` rules from disk. Workers has no
  project filesystem and cannot compile WebAssembly from bytes at run time, so
  once a game is registered the modules would have to be imported as Worker
  modules. No game is registered today, so the route only answers 404.
- Sign-in itself: the production Clerk key only works on orinks.net, and no
  development key was available. The middleware and the signed-out pages work.
- POST routes (game saves, events, presence, contact, notifications) were not
  exercised, to avoid writing to production Convex.
