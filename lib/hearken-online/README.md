# @hearken/online (copied)

`rules.js`, `service.js` and `index.js` are the server side of Hearken's
verified runs, copied unchanged from `server/src/` in
[orinks-games/hearken](https://github.com/orinks-games/hearken). They replay a
run in the game's published WebAssembly rules and hand the result to the game's
handler. `index.d.ts` is written here, for TypeScript.

To update, copy `rules.js` and `service.js` from that folder again. Copied at
hearken commit 2999eeb.
