# Syngen production workflow

Use `nicross/syngen-template` as the base for real audio games. Keep each game as a standalone project, then copy or publish its web build into this site's `public/games/<game-slug>` directory when it is ready for players.

## Local project layout

Recommended source project:

```text
C:/Users/your-name\gh-projects\pipe-dream-syngen
```

Recommended site deployment target:

```text
C:/Users/your-name\gh-projects\orinks-net\public\games\pipe-dream-iron-valve
```

## Template commands

From the standalone game project:

```sh
npm install
npx gulp dev
npx gulp build
npx gulp dist
```

Use `npx gulp dev` for local browser iteration. Use `npx gulp build` before copying the HTML5 build into `orinks-net`.

## Site integration rules

- Do not commit throwaway prototypes into `public/games`.
- Only add a playable route when a game has a real title, stable controls, and a repeatable build.
- Keep game source outside the Next app unless the game intentionally becomes a React application.
- Prefer one static folder per game under `public/games/<game-slug>`.
- Add or update `app/audio-games/page.tsx` when a build is player-facing.

## First candidate

Start with `Pipe Dream: Iron Valve`. Its mechanics are discrete, audio-readable, and easier to prototype in Syngen than a full transport sim or a larger arcade roguelite.
