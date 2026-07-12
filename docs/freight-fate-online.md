# Freight Fate Online Sharing

Freight Fate online identity is built on orinks.net accounts (Clerk). The
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

Display names must follow the published naming rules
(`/freight-fate/online/rules`). `provisionDriver` screens each name via
`convex/moderation.ts` (the `obscenity` package plus a hate-figure list)
and rejects violations with `ConvexError({ code: "name_rejected" })`;
public read paths additionally mask any stored name that fails screening.
Moderators can reset a name with the internal mutation
`freightFateAdmin:forceRename` (run from the Convex dashboard or
`npx convex run`), which flags the driver so the setup page demands a new
name; pass `regenerateId: true` when the offending text is baked into the
`driverId` slug itself.

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

Expanded journal/profile sharing uses consent version 2. Existing drivers are
not migrated implicitly: the setup form must record a new explicit opt-in.
Without that exact version, journal, achievement, snapshot, profile, and public
feed queries return no expanded data even when the legacy presence board was
enabled.

The structured endpoints are:

- `POST /api/freight-fate/events/delivery` for allowlisted delivery facts;
- `POST /api/freight-fate/events/achievement` for official achievement data;
- `POST /api/freight-fate/profile-snapshot` for version 1 career summaries.

The snapshot contains only driver level/title, last-saved city, career totals,
reputation, current truck label, ownership/employment status, and capture time.
It never contains the full save, money, coordinates, facilities, active cargo,
route position, or exact live location. The server formats trusted delivery
summary text from structured facts and clamps client timestamps.

## Career 1.9 activation plan

The snapshot table reserves a server-private future compatibility envelope,
but current mutations do not accept it and current queries never return it.
Before Career 1.9 activation, add explicit validators and allowlists for each
business, fleet, trailer, authority, inspection, route, and ownership field;
backfill only from newly published signed-in snapshots; add a new consent
version if the disclosure changes; and gate every new field behind the server
feature flag and public-query projection. No 1.9 label or field is active in
the current UI.

- `delivery_settled`: summary, on-time result, damage band, miles, route endpoints, net pay band.
- `career_milestone`: level, reputation band, endorsement unlock, owner-operator progress.
- `challenge_completed`: weather, mountain, HOS, or long-haul completion.

Do not post raw save files, route snapshots, exact local paths, or unrestricted telemetry.
