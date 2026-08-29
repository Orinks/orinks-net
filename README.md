# orinks.net

Next.js port of orinks.net away from WordPress.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Convex for persistent site data
- GitHub release data for project downloads
- Vercel hosting

## Development

```powershell
npm install --no-audit --no-fund
npm run dev
```

Run `npx convex dev` to connect the project to a Convex development deployment. The visitor counter API reads `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`; set both for parity with hosted environments. Visitor counters are separated by environment key so preview/dev traffic can share the same Convex deployment without changing production totals. The key is derived from Vercel (`production`, `preview-dev`, branch previews, or `local`) and can be overridden with `VISITOR_COUNTER_ENV` when needed. Set `GITHUB_TOKEN` to raise GitHub API rate limits for release data.

## Production

Production is hosted on Vercel. Pushes to `main` create production deployments for `orinks.net`.

## Deploy

Vercel is connected to the GitHub repository and creates deployments automatically:

- `main` deploys to production.
- `dev` and pull requests deploy as previews.
- GitHub Actions runs lint, typecheck, and build validation only.

The Convex backend follows the same split, and it is `CONVEX_DEPLOY_KEY` that decides it: the Production scope holds a production deploy key, and the Preview scope holds a **preview** deploy key, which builds a fresh deployment named for the branch and cannot write to production. So a preview is a preview all the way down, and schema changes reach live data only from `main`.

This is worth stating because it was not always true. The Preview scope previously held a *production* key, which meant every push to `dev` deployed Convex functions straight to production while the site itself was only a preview. If Convex ever deploys somewhere unexpected, check which kind of key that scope holds first.

Leave `CONVEX_URL` and `NEXT_PUBLIC_CONVEX_URL` unset in the Preview scope so the deploy can fill them in; see `.env.example`.

Convex deployments need `CONVEX_DEPLOY_KEY` configured in Vercel or the build pipeline. The build command runs Convex before the Next.js build so the functions are deployed with the site, and names the URL variable explicitly rather than relying on framework detection — the client must be built against whichever deployment the key just targeted:

```powershell
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npm run build"
```

`vercel.json` wraps this in a check for `CONVEX_DEPLOY_KEY` so a build without one still runs `npm run build` alone.

### Freight Fate music download

Set `FREIGHT_FATE_MUSIC_BLOB_URL` to the public Vercel Blob URL for the Freight Fate music pack. It must use an HTTPS host ending in `.public.blob.vercel-storage.com` and the fixed pathname `/freight-fate/music.pak`.
