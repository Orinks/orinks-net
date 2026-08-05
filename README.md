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

Note what that does and does not isolate. `CONVEX_DEPLOY_KEY` is a *production* deploy key and it is scoped to Preview (dev), so a push to `dev` deploys Convex functions to the production deployment. The site is a preview; the backend it deploys is production. Schema changes reach live data from `dev`, not from `main`.

A branch that changes the Convex schema should therefore run against its own isolated backend: give that branch's Preview environment a Convex **preview** deploy key and leave `CONVEX_URL` and `NEXT_PUBLIC_CONVEX_URL` unset for it, so `npx convex deploy` creates a fresh per-branch deployment instead. See `.env.example` for the full setup, including the Clerk development-instance keys such a branch also needs.

Convex production deployments need `CONVEX_DEPLOY_KEY` configured in Vercel or the build pipeline. The Vercel build command should run Convex before the Next.js build so the Convex functions are deployed with the site:

```powershell
npx convex deploy --cmd "npm run build"
```
