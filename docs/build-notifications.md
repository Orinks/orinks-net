# Build Notifications

Browser build notifications use the free Web Push standard. There is no separate push-notification vendor account for this site, but normal Vercel and Convex usage still applies.

## Configure

Generate VAPID keys:

```powershell
npx web-push generate-vapid-keys
```

Add these environment variables in Vercel and local `.env.local` when testing:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:notifications@orinks.net"
BUILD_NOTIFICATION_TOKEN=""
```

`BUILD_NOTIFICATION_TOKEN` can be any long random secret. GitHub Actions should send it as a bearer token when announcing a build.

## Send a build notification

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://orinks.net/api/notifications/send" `
  -Headers @{ Authorization = "Bearer $env:BUILD_NOTIFICATION_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"product":"AccessiWeather","title":"AccessiWeather build available","body":"A new AccessiWeather build is ready to download.","url":"/accessiweather/downloads"}'
```
