# Freight Fate live dispatch

A Dispatch player runs a carrier on orinks.net. Freight Fate players join it
with an invite code, and the dispatcher routes them through a mailbox: orders
go from the desk to the truck, replies come back, and the heartbeat says where
the truck is. Nobody has to be online at the same time.

Server code: `convex/freightFateDispatch.ts` (tables, calls, night desk),
`convex/freightFateDispatchTruck.ts` (heartbeat and flag), routes under
`app/api/freight-fate/dispatch/`. Tests: `convex/freightFateDispatch.test.ts`
runs a full fake-driver shift.

## Turning it on

Set `FREIGHT_FATE_LIVE_DISPATCH` on the Convex deployment:

- unset or `off`: every dispatch call answers `403 not_enabled`, the heartbeat
  behaves exactly as before, and the cron reads nothing.
- a comma-separated list of driver ids: only those drivers.
- `on`: everyone.

`node scripts/fake-dispatch-driver.mjs` plays both sides against a real
deployment with two driver tokens (see the script header).

## Calls

Every call sends the game's driver token as `Authorization: Bearer ...`. POST,
PATCH and DELETE bodies carry `driverId`; GETs take `?driverId=`. A refusal is
`{ ok: false, error: "<reason>" }` with a status: 401 `unauthorized`, 403
`not_enabled`, 404 `no_carrier` / `not_a_member` / `invite_not_found` /
`order_not_found`, 409 `already_in_carrier` / `order_closed` / `notes_muted` /
`wrong_order_kind`, 400 `invalid_payload` (with `field`), 422 `text_blocked`,
429 `rate_limited`.

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/freight-fate/dispatch` | driver | Their carrier, standing rules, open and accepted orders, `ownsCarrierId`, and `ended` for a day after the desk released them or the carrier closed |
| `PATCH /api/freight-fate/dispatch` | driver | `notesMuted` |
| `POST /dispatch/join` | driver | `inviteCode`; spaces and case don't matter |
| `POST /dispatch/leave` | driver | Leaves at once and clears the queue |
| `POST /dispatch/replies` | driver | `replyId`, `kind`, `orderId?`, `payload?` |
| `GET /dispatch/carrier` | desk | Carrier and invite code, roster, open orders, unheard replies |
| `POST /dispatch/carrier` | desk | Opens a carrier: `name`, `homeTerminal`, `secondTerminal?`, `nightDispatcherDefault?` (default on), `lanes?` |
| `PATCH /dispatch/carrier` | desk | Any of those, or `newInviteCode: true` |
| `DELETE /dispatch/carrier` | desk | Closes it; every driver is released |
| `PATCH /dispatch/members` | desk | `memberDriverId`, `nightDispatcher` (true, false, or null for the carrier default), `standingRules` |
| `DELETE /dispatch/members` | desk | Releases `memberDriverId` |
| `POST /dispatch/orders` | desk | `orderId`, `memberDriverId`, `kind`, `payload` |
| `DELETE /dispatch/orders` | desk | Withdraws `orderId` |
| `PATCH /dispatch/replies` | desk | Marks `replyIds` heard |

`orderId` and `replyId` are chosen by the sender. Sending the same one twice
answers `duplicate: true` and changes nothing.

## Orders

| kind | payload | Expires (real time) |
| --- | --- | --- |
| `load_offer` | `jobSeed`, `origin`, `destination`, `cargo?`, `pay?` (dollars), `miles?`, `appointment?`, `routeName?`, `fuelStop?`, `pickupBy?` | `pickupBy`, ten minutes to seven days out, default one day. Once accepted it has fourteen days to deliver |
| `route` | `routeName`, `fuelStop?`, `loadOrderId?` | Closes when that load delivers; fourteen days at most |
| `go_home` | `terminal`, `byWhen?` | Seven days |
| `note` | `text` (280 characters, screened) | Seven days |

`appointment`, `byWhen` and standing-rule `homeBy` are spoken game-time text
("Thursday 2 PM"); the driver's own game clock decides them. Order status runs
`open`, then `accepted`, `declined`, `done`, `lapsed` or `withdrawn`.

## Replies

| kind | Answers | payload |
| --- | --- | --- |
| `accepted` | load offer, route, go home | none |
| `declined` | the same | `reason?` |
| `counter` | load offer, go home (the order stays open) | `hosMinutesLeft?`, `canReach?`, `homeBy?`, `text?` |
| `delivered` | an accepted load offer | `onTime`, `minutesLate?`, `detentionMinutes?`, `miles?`, `pay?`, `lateReason?` |
| `heard` | a note; the desk gets nothing | none |
| `trouble` | none | `trouble`: breakdown, inspection, citation or out_of_hours; `text?` |
| `signed_on`, `parked` | none | none; the server attaches the truck state |

Minutes in replies are game minutes. Answering an order that already closed
returns `409 order_closed` with its `status`, so the game can say the offer
lapsed or was taken back.

The desk also hears from the server, with `source: "server"`: `joined`,
`left`, `night_desk` (with origin, destination and cargo) and `lapsed` (with
the order kind and whether it had been accepted).

## Heartbeat

The existing presence POST takes an optional `truck` object:
`{ city, loaded, nextWaypoint?, hosMinutesLeft?, fuelPercent?, cargo? }`.
Send it on change. For a carrier member with dispatch on, it lands on their
membership row, which keeps it after sign-off, so the desk sees where the
truck parked. A sign-off beat may carry it too. The public board never shows
it. The reply then includes `dispatch: { carrierId, openOrders }`, so the game
fetches orders only when some are waiting.

## The night desk

Every five minutes a cron lapses expired orders, then looks at each carrier
driver who is signed on (not paused), empty, has the night desk on, and has no
load offer or run home queued. It offers one load from the carrier's lanes:
a lane out of the driver's city first, then a lane from anywhere, otherwise a
run to a terminal the driver is not already at. It waits thirty minutes before
offering the same driver another. The desk hears each one as a `night_desk`
reply.

Closed orders and heard replies are dropped after thirty days.
