# Hearken games online

Hearken games can send runs to orinks.net to be checked and counted. A run is
the game's seed and the player's inputs. The site replays it with the game's
own rules, built to WebAssembly by `hearken release`, and gives the result it
computed to that game's handler. The handler decides what the result is for: a
board, a best time, a ghost, an unlock. Nothing the game says about its own
score is trusted.

The protocol and the engine side are in Hearken's `docs/online.md`.

## How it fits together

- `app/api/games/[game]/[...path]/route.ts` serves every game at
  `/api/games/<id>/`.
- `lib/games/registry.ts` lists the games and their handlers.
- `hearken-rules/<id>/` holds each game's published rules modules.
- `lib/hearken-online/` is the server library, copied from Hearken.
- `convex/games.ts` stores players, game tokens, connect codes, run claims and
  the records handlers keep.
- `/games/connect` is where a player enters the code their game speaks.

One player per orinks.net account is shared by every game. The token each game
holds works for that game only.

## Setup

Set `GAMES_SERVER_SECRET` to the same random value, 32 characters or more, in
two places: the Convex deployment's environment variables, and Vercel's. Every
Convex function that writes a verified result checks it. Without it, the games
route answers 503.

## Adding a game

1. In the game, follow Hearken's `docs/online.md`: a rules crate,
   `rules = "<crate>"` in `[package.metadata.hearken]`, and `Game::online()`
   returning `https://orinks.net/api/games/<id>` with the site name
   `orinks.net`.
2. Copy the `<game>-<version>-rules-<id>.wasm` that `hearken release` puts in
   `dist/` into `hearken-rules/<id>/`. Do this for every release whose runs
   should count.
3. Add the game to `GAMES` in `lib/games/registry.ts`, with a handler for each
   kind of run it sends. A handler says what a run must have started from
   (`expect`) and what to do with the verified result (`accept`). It can also
   hand out seeds (`start`) and answer reads (`read`). `records` is the game's
   own store:

```ts
wickets: {
  id: "wickets",
  title: "Wicket's",
  handlers: (records) => ({
    daily: {
      expect: () => ({ rules: "belfry", seed: todaysSeed(), context: { mode: "daily" } }),
      async accept({ player, verified }) {
        const score = verified.outcome.score;
        const board = `daily:${today()}`;
        // Kept only if it beats the player's stored score, in one step.
        await records.putBest(board, player.id, { value: { name: player.name, score }, order: score, playerId: player.id });
        return { score, rank: (await records.ahead(board, score)) + 1 };
      },
      read: async ({ path }) => ({ top: (await records.list(`daily:${path[0] ?? today()}`)).map((r) => r.value) }),
    },
  }),
},
```

`lib/games/service.test.ts` runs a game like this end to end against a real
rules module.

Things a handler should know:

- `accept` may, rarely, run twice for one run: if saving its reply fails, the
  run can be sent again a couple of minutes later. `putBest`, or anything
  keyed by `verified.run_id`, makes that harmless.
- Pass `playerId` on any record that belongs to a player, so deleting the
  account deletes it.
- A record's value is at most 8 KB. `ahead` counts at most 1000, so past that
  a rank reads as 1001.

## Previews

`dev` previews build against the staging Convex deployment and do not deploy
it, so `convex/games.ts` and its tables reach staging only when the backend
is deployed there by hand. `main` deploys production as usual.
