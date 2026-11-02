# orinks.net

Next.js port of orinks.net away from WordPress.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Convex for persistent site data
- GitHub release data for project downloads
- Cloudflare Workers hosting (built with vinext)

## Development

```powershell
npm install --no-audit --no-fund
npm run dev
```

Run `npx convex dev` to connect the project to a Convex development deployment. The visitor counter API reads `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`; set both for parity with hosted environments. Visitor counters are separated by environment key so preview/dev traffic can share the same Convex deployment without changing production totals. The key is derived from Vercel (`production`, `preview-dev`, branch previews, or `local`) and can be overridden with `VISITOR_COUNTER_ENV` when needed. Set `GITHUB_TOKEN` to raise GitHub API rate limits for release data.

## Production

Production runs on Cloudflare Workers: the `orinks-net` Worker serves `www.orinks.net`, and Cloudflare redirects the apex `orinks.net` to it. DNS is on Cloudflare. See `CLOUDFLARE.md` for the build, the Worker's secrets and how the move from Vercel was done.

## Deploy

Pushes to `main` run `.github/workflows/cloudflare-deploy.yml`, which deploys the Convex functions to production and builds and uploads the Worker in one step (`scripts/cloudflare-build.mjs --target production`):

```powershell
npx convex deploy --typecheck try --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npx vite build --mode production"
npx vinext-cloudflare deploy --skip-build --env production
```

The URL variable is named explicitly so the client is built against whichever deployment the key just targeted, and a production run without `CONVEX_DEPLOY_KEY` fails instead of shipping the site without its backend. This workflow is the only thing that deploys the Convex backend; Vercel's Git integration is disconnected, so `dev` and other branches no longer get preview deployments. A preview Worker (`orinks-net-preview` on workers.dev, never touches Convex) can be deployed from any branch with "Run workflow" and target `preview`.

GitHub Actions CI (`ci.yml`) still runs lint, typecheck and build validation on `dev` and `main`.

`vercel.json` and `scripts/vercel-build.mjs` are kept for now in case the site has to go back to Vercel.

### Freight Fate music download

Set `FREIGHT_FATE_MUSIC_BLOB_URL` to `https://crisp-crystal-9a9y.here.now/music.pak`, the verified permanent public URL for the Freight Fate music pack.
