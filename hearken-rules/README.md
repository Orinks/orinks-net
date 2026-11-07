# Published rules modules for Hearken games

Each game has a folder named after its id in `lib/games/registry.ts`, such as
`hearken-rules/wickets/`. `hearken release` writes a game's module as
`<game>-<version>-rules-<id>.wasm`. Runs recorded by a release whose module is
here are accepted; runs from any other release are refused as `unknown-build`.

Nobody copies these by hand. A game listed in `sources.json` attaches each
release's module to its GitHub release, and every deploy fetches the modules
of its newest 40 releases (`npm run rules:fetch`,
`scripts/fetch-hearken-rules.mjs`). The fetched files are not committed. A
release then asks for a production deploy (a `hearken-rules` repository
dispatch), so its runs count within minutes of the release.

A module committed here by hand is bundled too, for a game with no releases
to fetch from.
