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
