# orinks.net

Next.js port of orinks.net away from WordPress.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Optional Neon serverless Postgres health check
- GitHub release data for project downloads
- Vercel hosting

## Development

```powershell
npm install --no-audit --no-fund
npm run dev
```

Set `DATABASE_URL` if you want `/api/health` to verify Neon connectivity. Set `GITHUB_TOKEN` to raise GitHub API rate limits for release data.

## Production

Production is hosted on Vercel. Pushes to `main` create production deployments for `orinks.net`.

## Deploy

Vercel is connected to the GitHub repository and creates deployments automatically:

- `main` deploys to production.
- `dev` and pull requests deploy as previews.
- GitHub Actions runs lint, typecheck, and build validation only.
