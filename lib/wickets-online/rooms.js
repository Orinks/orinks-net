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

/**
 * Ready lines at a table: sent by id, so each player hears them in their
 * own game's words, and a guest can send them. The text here is what the
 * server keeps and a report shows.
 */
export const TABLE_LINES = {
  "good-luck": "Good luck.",
  "good-game": "Good game.",
  "nice-one": "Nice one.",
  thanks: "Thanks.",
  "one-moment": "One moment.",
  back: "Back.",
  again: "Again?",
  "have-to-go": "I have to go.",
};

/** Typed chat at a table: 10 a minute, a second apart, 120 characters. */
const TABLE_CHAT = { per_minute: 10, gap: 1, max_chars: 120 };

export const ROOM_KINDS = {
  // The Parlor: one channel for everyone in Wicket's, accounts only.
  // Lines are kept two days.
  parlor: {
    seats: { min: 1, max: 200 },
    history: 2 * 86_400,
    idle_limit: 0,
    chat_limit: { per_minute: 6, gap: 3, max_chars: 120 },
    quick: { hello: "Hello.", "anyone-for-a-game": "Anyone for a game?" },
    guest_chat: "none",
  },
  pebbles: {
    chat_limit: TABLE_CHAT,
    quick: TABLE_LINES,
    guest_chat: "quick",
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
