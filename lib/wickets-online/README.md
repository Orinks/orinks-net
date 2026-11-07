# Wicket's leaderboards (copied)

The handlers behind `/api/games/wickets/`: daily, weekly and monthly
challenge boards for Safecracker, Belfry, Fireside Patience, Riverboat Dice
and Sonar Dive. Copied from `server/src/` in Wicket's private repository;
the one change is `index.js` importing `../hearken-online/index.js` in
place of `@hearken/online`. Update by copying those files again.
`index.d.ts` is written here, for TypeScript.

- Seeds are HMAC-SHA256 of `WICKETS_SEED_SECRET` (32 characters or more,
  set where `GAMES_SERVER_SECRET` is) and the period. Without it the
  route answers 503.
- Boards are kept in the game's records (`recordsBoards`): no tables of
  their own.
- Each release's rules module is fetched from its GitHub release at deploy
  (`hearken-rules/sources.json`).
