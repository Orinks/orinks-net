# Freight Fate Online Sharing

Freight Fate online identity is built on Orinks accounts (Clerk). The
website issues driver credentials after sign-in; the desktop game only ever
posts presence and road-journal events with those credentials. There are no
pairing codes and no setup sessions — the old `/api/freight-fate/setup`
endpoint no longer exists.

## Setup Flow

1. The player signs in on `https://orinks.net/freight-fate/online/setup`
   (Clerk account; one driver per account).
2. The page's **Set up driver** form calls the authenticated Convex mutation
   `freightFate.provisionDriver`, which creates the driver (public
   `driverId` slug derived from the display name) and mints a posting token
   (`ffd_` + 64 hex chars). Only a SHA-256 hash of the token is stored; the
   plaintext is shown once in the "Connect Freight Fate" panel.
3. The player copies the Driver ID and the token from that panel and pastes
   them into the game (Settings → Online). The game verifies them with one
   empty-activity presence post, then stores them locally.
4. **Rotate token** on the setup page mints a replacement and invalidates
   the old one; the game reports `unauthorized` until the new token is
   pasted.

The driver's display name and visibility (`public` / `unlisted` /
`private`) are managed on the website only. The live drivers board lists
only `public` drivers with a fresh heartbeat (3-minute TTL).

## Presence Heartbeat

`POST /api/freight-fate/presence` — Header: `Authorization: Bearer <driverToken>`

```json
{
  "driverId": "road-star-1a2b3c4d",
  "activity": "Driving: Chicago to Dallas",
  "detail": "steel coils, 45% there"
}
```

An **empty** `activity` is an explicit off-duty sign-off: it removes the
driver from the board immediately (also how the game verifies pasted
credentials without appearing on duty). Errors: `404 driver_not_found`
(unknown driver ID), `401 unauthorized` (token hash mismatch).

`GET /api/freight-fate/presence` returns the public board:
`{ "asOf": <ms>, "drivers": [{ "driverId", "displayName", "activity", "detail", "updatedAt" }] }`.

## Post Road Journal Event

`POST /api/freight-fate/events` — Header: `Authorization: Bearer <driverToken>`

```json
{
  "driverId": "road-star-1a2b3c4d",
  "eventId": "settlement-2026-06-28T18-30-00Z",
  "eventType": "delivery_settled",
  "summary": "Delivered refrigerated freight to Denver on time with no cargo damage.",
  "occurredAt": 1782670000000
}
```

Events are idempotent on `(driverId, eventId)` — a repeat post returns
`duplicate: true`. Events appear on the driver's public profile page
(`/freight-fate/drivers/<driverId>`) unless the profile is private.

Recommended first game-side events:

- `delivery_settled`: summary, on-time result, damage band, miles, route endpoints, net pay band.
- `career_milestone`: level, reputation band, endorsement unlock, owner-operator progress.
- `challenge_completed`: weather, mountain, HOS, or long-haul completion.

Do not post raw save files, route snapshots, exact local paths, or unrestricted telemetry.
