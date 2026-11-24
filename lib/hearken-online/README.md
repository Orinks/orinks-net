# @hearken/online (copied)

`rules.js`, `service.js`, `names.js`, `refusal.js`, `rooms.js`, `saves.js`, `memory.js` and `index.js` are the server side of Hearken's
verified runs, copied unchanged from `server/src/` in
[orinks-games/hearken](https://github.com/orinks-games/hearken). They replay a
run in the game's published WebAssembly rules and hand the result to the game's
handler. `index.d.ts` is written here, for TypeScript.

To update, copy those files from that folder again (`index.js` here
re-exports only what the site uses). Copied at hearken commit 25a60f9 (main, with rooms and text chat).
