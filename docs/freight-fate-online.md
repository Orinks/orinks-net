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

The driver's display name is managed on the website. Sharing is a single
Profile sharing toggle, settable on the website or from inside the game
(`POST /api/freight-fate/profile-sharing`): on stores `public`, off stores
`private`. The stored visibility field keeps a legacy `unlisted` value
(profile reachable by link only) for drivers created before the single
toggle. The live drivers board lists only `public` drivers with a fresh
heartbeat (3-minute TTL).

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

Expanded journal/profile sharing uses consent version 3. Existing drivers are
not migrated implicitly: the setup form must record a new explicit opt-in.
Without that exact version, journal, achievement, detailed career statistics,
profile, and public feed queries return no expanded data even when the legacy
presence board was enabled.

The structured endpoints are:

- `POST /api/freight-fate/events/delivery` for allowlisted delivery facts;
- `POST /api/freight-fate/events/achievement` for official achievement data.

The public career summary is derived only from an accepted private Cloud Backup
revision. It contains driver level/title, last-saved city, career totals,
reputation, current truck label, ownership/employment status, and acceptance
time. The full save never enters a public query. The server formats trusted
delivery summary text from structured facts and clamps client timestamps.

## Career 1.9 activation plan

The server-derived profile summary table reserves a private future
compatibility envelope, but current queries never return it.
Before Career 1.9 activation, add explicit validators and allowlists for each
business, fleet, trailer, authority, inspection, route, and ownership field;
backfill only from newly accepted validated Cloud Backup revisions; add a new
consent version if the disclosure changes; and gate every new field behind the
server feature flag and public-query projection. No 1.9 label or field is
active in the current UI.

- `delivery_settled`: summary, on-time result, damage band, miles, route endpoints, net pay band.
- `career_milestone`: level, reputation band, endorsement unlock, owner-operator progress.
- `challenge_completed`: weather, mountain, HOS, or long-haul completion.

Do not post raw save files, route snapshots, exact local paths, or unrestricted telemetry.

## Validated private cloud revisions

Cloud Backup and Profile sharing are independent. The authenticated saves API
accepts a private backup only after validating the portable profile, then
stores the revision with an Ed25519 signature. Authenticated downloads use
`cache-control: no-store` and include signing metadata for the game to verify.
Legacy unsigned revisions are validated and signed on their first authenticated
download. The public profile never receives the full backup; its allowlisted
career details are derived from the most recently accepted revision.

The validator allowlists are generated from the game catalogs into
`data/freight-fate-profile-invariants.json`. From the Freight Fate repository,
run `uv run python tools/export_profile_integrity_invariants.py
../orinks-net/data/freight-fate-profile-invariants.json`, then commit both sides
of the contract in the same change whenever the game adds a city, achievement,
truck, upgrade, market cargo key, or save-schema version. Gated possessions
such as Golden Antlers must not be added until the server can validate their
grant trail.

Signing configuration lives only in the Convex environment:

```text
FREIGHT_FATE_PROFILE_SIGNING_KEY_ID=2026-07
FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY=<base64 PKCS8 DER>
```

Generate a rotation pair with
`node scripts/generate-freight-fate-profile-key.mjs YYYY-MM <private-output>`.
Move the private value into the secrets manager, never commit it, and add the
reported raw public key to the game's `PUBLIC_KEYS` map before signing with the
new key ID. Old public keys stay in the game while private revisions using them
remain restorable.

## Mastodon sharing of notable deliveries

The player links their own Mastodon account (any instance) to their driver on
the Clerk-authenticated page at `/freight-fate/online/mastodon`; the game then
offers notable deliveries and the server composes and posts the status. All
logic lives in `convex/freightFateMastodon.ts`.

- **Linking (browser, Clerk):** the page calls the `beginLink` action with the
  instance host. The server registers this deployment on that instance once
  (`POST /api/v1/apps`, dynamic — no pre-provisioned secrets), stores the
  per-instance app in `freightFateMastodonApps`, mints a single-use state row
  (10-minute TTL), and returns the authorize URL. The instance redirects back
  to `/api/freight-fate/mastodon/callback`, which runs `completeLink`:
  redeem state, exchange the code, `verify_credentials` for the display
  handle, and upsert `freightFateMastodonLinks` (one per driver). Scope is
  `read:accounts write:statuses` (read:accounts only feeds
  verify_credentials for the spoken handle). App rows remember their
  scopes; a scopes change makes beginLink re-register automatically. Unlink deletes the row and best-effort revokes the
  token at the instance.
- **Posting (game, bearer driver token):** `POST
  /api/freight-fate/mastodon/share` with `{driverId, eventId, occurredAt,
  payload}`. The payload carries allowlisted facts (cargo, cities, distance,
  on-time) plus `reasons` — new achievements, a level, a perfect-streak milestone.
  Reason-free (routine) payloads are refused; `composeMastodonStatus` builds
  the post text server-side, strips `@`/`#` from every fact, clamps to 500
  characters, and appends `#FreightFate`. Rate limit: scope `mastodon-share`,
  6 per minute per driver. Duplicates are caught by the link row's
  `lastEventId` and by the instance-side `Idempotency-Key`.
- **Status (game):** `GET /api/freight-fate/mastodon/status?driverId=...`
  answers `{linked, handle}` for the game's spoken "Check link status" item.
- **Env:** `FREIGHT_FATE_MASTODON_REDIRECT_URI` (Convex env, optional)
  overrides the callback URL for previews/dev; the default is
  `https://www.orinks.net/api/freight-fate/mastodon/callback`. No other
  secrets — per-instance app credentials are table rows, and access tokens
  live in `freightFateMastodonLinks` (never returned by any public query).
