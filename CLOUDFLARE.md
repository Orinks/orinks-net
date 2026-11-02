# Cloudflare Workers build

orinks.net runs on Cloudflare Workers with
[vinext](https://github.com/cloudflare/vinext), Cloudflare's recommended Next.js
adapter. Convex and Clerk are unchanged. `next dev` / `next build` and the
Vercel build still work, but Vercel no longer deploys anything.

A preview Worker is deployed at
https://orinks-net-preview.orinks.workers.dev (free plan, not indexed, its own
visit-counter key). The production Worker `orinks-net` serves
www.orinks.net and orinks.net (custom domains; the apex redirects to www) and
has no workers.dev address. orinks.net moved from Vercel on 2026-11-02.

## Targets

The Worker is built in one of two modes (`cloudflare.config.ts`):

| Mode | Worker | `VERCEL_ENV` | Visit counter key | Indexed |
| --- | --- | --- | --- | --- |
| `preview` | `orinks-net-preview` | `preview` | `cloudflare-preview` | No (`robots.txt` disallows all) |
| `production` | `orinks-net` | `production` | `production` | Yes |

Any mode other than `production` (including `vite dev`) is treated as a
preview. The preview only requires `CONVEX_URL`, `CLERK_SECRET_KEY` and
`FREIGHT_FATE_MUSIC_BLOB_URL`; the production Worker requires every secret
listed below, so a deploy that forgot one fails instead of shipping a site
with silently missing features. Per-version preview URLs are off.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build:cf:preview` | Builds the preview Worker into `.cloudflare/output/` and `dist/` (both gitignored). Never touches Convex. |
| `npm run build:cf:production` | Builds the production Worker locally (no Convex deploy, no upload). |
| `npm run deploy:cf:preview` | Builds and uploads `orinks-net-preview`. |
| `npm run deploy:cf:production` | Deploys Convex to production, builds inside `convex deploy`, uploads `orinks-net` (see "Convex deploy step"). |
| `npm run build:vinext` | Same as `build:cf:preview` without the wrapper script. |
| `npm run start:vinext` | Serves the last build in workerd on http://localhost:4173 (`vite preview`). |
| `npm run dev:vinext` | Vite dev server in workerd, with hot reload. |

Builds rewrite `next-env.d.ts`; do not commit that change (`vinext-env.d.ts`
carries vinext's types). Deploys need `CLOUDFLARE_API_TOKEN` (and
`CLOUDFLARE_ACCOUNT_ID` if the token can see more than one account).

The first upload of a Worker must carry its required secrets, because a
Worker that does not exist yet cannot have secrets set in advance:

```
npx cf deploy --prebuilt --mode preview --secrets-file /path/outside/repo/secrets.json
```

After that, `cf workers secrets put NAME --worker <worker>` (or the
dashboard) updates them, and ordinary deploys keep them.

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
  `VERCEL_ENV`, `VISITOR_COUNTER_ENV` (both set per mode), `MASTODON_PROFILE_URL`,
  `VAPID_SUBJECT`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`.
- Secrets are declared with `bindings.secret()`:
  every Worker: `CONVEX_URL`, `CLERK_SECRET_KEY`, `FREIGHT_FATE_MUSIC_BLOB_URL`;
  production only: `GITHUB_TOKEN`, `LASTFM_API_KEY`, `LASTFM_USERNAME`,
  `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`,
  `SPOTIFY_REDIRECT_URI`, `SPOTIFY_LOGIN_KEY`, `VAPID_PRIVATE_KEY`,
  `RESEND_API_KEY`, `BUILD_NOTIFICATION_TOKEN`.
  `GAMES_SERVER_SECRET` is read by the games service but is not set on Vercel
  either, so it is not required; add it when a game goes live.
  Locally they come from `.dev.vars` (copy `.dev.vars.example`). On Cloudflare
  they are set with `cf workers secrets put NAME --worker <worker>` or in the
  dashboard.
- Most of these are "Sensitive" on Vercel, which means Vercel will not show
  or export their values (`vercel env pull` returns placeholders). They have
  to come from where they were created (Clerk, Spotify, Last.fm, GitHub,
  Resend dashboards, the VAPID key pair) or be regenerated.
- Convex-side variables (`TURNSTILE_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`,
  `FREIGHT_FATE_*` signing and review secrets) live on the Convex deployment
  and are unaffected by the move.

Vercel-only variables: `VERCEL_ENV` is kept (set per mode) because the site
reads it for `robots.txt` and the visit counter. `VERCEL_GIT_COMMIT_REF` does
not exist on Workers, so `VISITOR_COUNTER_ENV` is set explicitly. The Convex
deploy key stays a CI secret; it is never a Worker value.

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
| `vercel.json` build (Convex deploy, then build) and ignore step | `scripts/cloudflare-build.mjs`, run by `.github/workflows/cloudflare-deploy.yml` (manual for now). See "Convex deploy step". |
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

On Cloudflare itself (preview Worker, 2026-10-31, 92 requests over 26 paths,
3 requests each, some cold): CPU p50 10.2 ms, p90 47 ms, p99 222 ms (cold
starts), and no request was failed for CPU. The free plan tolerates
occasional overruns, so the preview works for testing, but sustained traffic
at these numbers needs Workers Paid.

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

## Convex deploy step

On Vercel, `vercel.json` runs `scripts/vercel-build.mjs`: for main it runs
`npx convex deploy --typecheck try --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npm run build"`
with the production `CONVEX_DEPLOY_KEY`, retrying transient Convex errors, and
refuses to build main without the key.

`scripts/cloudflare-build.mjs` is the Workers equivalent and reuses the same
retry rule (`isTransientConvexFailure`):

- `--target production`: requires `CONVEX_DEPLOY_KEY`, runs
  `npx convex deploy --typecheck try --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npx vite build --mode production"`
  (so the Worker is built against the URL of the deployment it just pushed),
  then `npx vinext-cloudflare deploy --skip-build --env production`.
- `--target preview`: `npx vite build --mode preview`, then
  `npx vinext-cloudflare deploy --skip-build --env preview`. No Convex.
- `--build-only` stops after the build.

It runs from `.github/workflows/cloudflare-deploy.yml`: every push to dev
deploys the preview Worker, every push to main deploys production, and "Run workflow" deploys either target by hand
(production only from main). The Vercel Git integration is disconnected, so
this workflow is the only pipeline that deploys the Convex backend. The
workflow needs repository secrets `CLOUDFLARE_API_TOKEN`, `CONVEX_DEPLOY_KEY`
and repository variables `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## DNS

`docs/cloudflare-dns.zone` is a BIND file of every record Vercel DNS holds
for orinks.net other than Vercel's own hosting records, ready for
Cloudflare's "Import DNS records". Summary:

| Name | Type | Value | Purpose |
| --- | --- | --- | --- |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | Resend SPF |
| `send` | MX | `10 feedback-smtp.us-east-1.amazonses.com` | Resend bounces |
| `resend._domainkey` | TXT | DKIM public key | Resend DKIM |
| `clerk` | CNAME | `frontend-api.clerk.services` | Clerk frontend API |
| `accounts` | CNAME | `accounts.clerk.services` | Clerk account portal |
| `clkmail` | CNAME | `mail.820699ghwl6q.clerk.services` | Clerk email |
| `clk._domainkey`, `clk2._domainkey` | CNAME | `dkim1/dkim2.820699ghwl6q.clerk.services` | Clerk DKIM |
| `@` | CAA x3 | letsencrypt.org, pki.goog, sectigo.com | Certificate authorities |

All of them must be DNS only (grey cloud); Clerk rejects proxied CNAMEs.
Not copied: the apex and `www` ALIAS records and the `*` wildcard, which only
point at Vercel. There is no apex MX, TXT or `_dmarc` record today.

Today the apex 307-redirects to `https://www.orinks.net/` (a Vercel domain
setting). On Cloudflare, attach `www.orinks.net` (and `orinks.net`) to the
`orinks-net` Worker as custom domains and add a Redirect Rule
`orinks.net/*` -> `https://www.orinks.net/${1}` (free), or the apex will serve
the site directly.

## Cutover checklist

Steps 1-7 were done on 2026-11-02. The push subscriptions made under the old
VAPID key stopped working with the new key, so subscribers have to turn build
notifications on again.


1. Add orinks.net to Cloudflare (free plan), import `docs/cloudflare-dns.zone`,
   and check every record is DNS only. Nothing changes until the nameservers do.
2. Buy Workers Paid ($5/month) so server-rendered pages are not held to 10 ms of CPU.
3. Collect the production secrets (see above) and do the first production
   upload with `--secrets-file` (outside the repo).
4. Smoke-test `https://orinks-net.orinks.workers.dev` (it is indexed-mode, so
   do this quickly; `workersDev` is off for production after cutover).
5. Attach `www.orinks.net` and `orinks.net` as Worker custom domains, add the
   apex redirect rule.
6. Switch the nameservers at DreamHost to the two Cloudflare gives.
7. Add the GitHub secrets/variables, turn on the `push: main` trigger and
   disconnect Vercel's Git integration in one change.
8. In Clerk, nothing changes (same domain); confirm sign-in on orinks.net.
9. Watch for a day, then downgrade Vercel. `FREIGHT_FATE_MUSIC_BLOB_URL`
   points at a file outside Vercel Blob, so it is unaffected; check
   `BLOB_READ_WRITE_TOKEN` users (dev scripts only) before deleting the project.
