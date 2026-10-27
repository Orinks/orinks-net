# Published rules modules for Hearken games

Each game has a folder named after its id in `lib/games/registry.ts`, such as
`hearken-rules/wickets/`. `hearken release` writes a game's module to its
`dist/` folder as `<game>-<version>-rules-<id>.wasm`; copy that file here to
publish it. Runs recorded by that release are then accepted, and runs from a
release whose module is not here are refused as `unknown-build`.

Keep a module here for as long as players may still play that release. Removing
it stops that release's runs being accepted.
