// Wicket's matches between players, on Hearken's rooms (`rooms` on the
// service). Each entry is a room kind: two seats, the rules the server
// replays every turn with, and what a match starts from.
//
// Pebbles: first to 3 rounds. The player who joins chooses the seat in
// round 1, then the loser of each round chooses. A seat that sits on its
// move for 3 days has left the match, and a match with no move for 30
// days is abandoned, as Hearken's example rules them.

/** A seed nobody can know before the match starts. */
function randomSeed() {
  return new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0, true).toString();
}

export const ROOM_KINDS = {
  pebbles: {
    rules: "pebbles",
    seats: { min: 2, max: 2 },
    // Replayed after every turn, so My games can say whose move it is.
    progress: true,
    turn_limit: 3 * 86_400,
    idle_limit: 30 * 86_400,
    // The knock stays off until a room can ask for it.
    start: () => ({ seed: randomSeed(), context: { knock: false } }),
    accept: ({ players, verified }) => {
      const winner = players.find((p) => p.seat === verified.outcome?.winner);
      return { winner: winner?.name ?? null, score: verified.outcome?.score ?? null };
    },
  },
};
