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

Run `npx convex dev` to connect the project to a Convex development deployment. The visitor counter API reads `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`; set both for parity with hosted environments. Set `GITHUB_TOKEN` to raise GitHub API rate limits for release data.

## Production

Production is hosted on Vercel. Pushes to `main` create production deployments for `orinks.net`.

## Deploy

Vercel is connected to the GitHub repository and creates deployments automatically:

- `main` deploys to production.
- `dev` and pull requests deploy as previews.
- GitHub Actions runs lint, typecheck, and build validation only.

Convex production deployments need `CONVEX_DEPLOY_KEY` configured in Vercel or the build pipeline. The Vercel build command should run Convex before the Next.js build so the Convex functions are deployed with the site:

```powershell
npx convex deploy --cmd "npm run build"
```
