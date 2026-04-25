# orinks.net

Next.js port of orinks.net away from WordPress.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Optional Neon serverless Postgres health check
- GitHub release data for project downloads

## Development

```powershell
npm install --no-audit --no-fund
npm run dev
```

Set `DATABASE_URL` if you want `/api/health` to verify Neon connectivity. Set `GITHUB_TOKEN` to raise GitHub API rate limits for release data.

## Production

Build with `npm run build` and run with `npm run start`. On a VPS, put a reverse proxy such as Caddy or Nginx in front of the Next.js process and point the domain at the server.

## Deploy

The Contabo VPS has a read-only GitHub deploy key and a deploy script at:

```bash
~/bin/deploy-orinks-net
```

Deployments run automatically from GitHub Actions after a successful push to `main`.
The workflow validates the app on a GitHub-hosted runner, then deploys on the
Contabo VPS through the repo's self-hosted runner labeled `orinks-net-prod`.

The deploy job creates a timestamped release under `~/apps/orinks-net/releases`,
runs `npm ci`, builds the app, updates the `current` symlink, restarts
`orinks-net.service`, and keeps the newest five releases.

To deploy manually, run:

```powershell
ssh Contabo '~/bin/deploy-orinks-net'
```

The script fetches `origin/main`, creates a timestamped release, runs `npm ci`, builds the app, updates the `current` symlink, restarts `orinks-net.service`, and keeps the newest five releases.
