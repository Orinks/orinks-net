# Freight Fate Online Sharing Slice

This first slice avoids pairing codes and accounts. Freight Fate creates the driver identity, opens Orinks with a setup URL, and the player confirms sharing in the browser.

## Setup Flow

1. Freight Fate generates:
   - `driverId`: stable public driver ID, at least 8 URL-safe characters.
   - `driverToken`: long random secret for future posts.
   - `setupToken`: short-lived random secret for browser confirmation.
2. Freight Fate calls `POST /api/freight-fate/setup`.
3. Orinks stores hashed tokens in Convex and returns `setupUrl`.
4. Freight Fate opens `setupUrl` in the player's browser.
5. The player confirms sharing on Orinks. No login is required.
6. Freight Fate polls `GET /api/freight-fate/setup?token=...` until `confirmed` is true, then stores `driverId` and `driverToken` locally.

## Create Setup Session

`POST /api/freight-fate/setup`

```json
{
  "driverId": "driver_8t7x2m9k",
  "driverToken": "long-random-secret",
  "setupToken": "short-lived-random-secret",
  "displayName": "Road Star",
  "expiresInMinutes": 15
}
```

Returns:

```json
{
  "ok": true,
  "driverId": "driver_8t7x2m9k",
  "setupUrl": "https://orinks.net/freight-fate/online/setup?token=...",
  "expiresAt": 1782670000000
}
```

## Check Setup Status

`GET /api/freight-fate/setup?token=...`

Returns:

```json
{
  "found": true,
  "confirmed": true,
  "expired": false,
  "driverId": "driver_8t7x2m9k",
  "profileUrl": "/freight-fate/drivers/driver_8t7x2m9k",
  "expiresAt": 1782670000000
}
```

## Post Road Journal Event

`POST /api/freight-fate/events`

Header: `Authorization: Bearer <driverToken>`

```json
{
  "driverId": "driver_8t7x2m9k",
  "eventId": "settlement-2026-06-28T18-30-00Z",
  "eventType": "delivery_settled",
  "summary": "Delivered refrigerated freight to Denver on time with no cargo damage.",
  "occurredAt": 1782670000000
}
```

Recommended first game-side events:

- `delivery_settled`: summary, on-time result, damage band, miles, route endpoints, net pay band.
- `career_milestone`: level, reputation band, endorsement unlock, owner-operator progress.
- `challenge_completed`: weather, mountain, HOS, or long-haul completion.

Do not post raw save files, route snapshots, exact local paths, or unrestricted telemetry.
