// The games with ranked boards, and the kinds of run each posts.
//
// A kind is "<game>-<period>", such as "safecracker-daily", and names the
// rules a run must have been played with and the context it started from.
// `score` reads the number a board ranks from a verified outcome; higher is
// better. `burst` is the most keys a person can press within the window
// the rules count (`Result::burst`): more than that and the run is held
// back for a look instead of shown; a game without it is not checked.
//
// A holiday mode or special gets `season`: its kinds exist only while
// `season.open(ms)` is true, so outside it the server answers as if the
// board never existed, and a board is kept per season, keyed by the year
// the season opened in (`season.key(ms)`), frozen once the season ends.

export const GAMES = {
  safecracker: {
    rules: "safecracker",
    periods: ["daily", "weekly", "monthly"],
    score: (outcome) => outcome.score,
    burst: 4,
  },
  // Played at the player's own pace, one step a key: no burst to check.
  belfry: {
    rules: "belfry",
    periods: ["daily", "weekly", "monthly"],
    score: (outcome) => outcome.score,
  },
  "fireside-patience": {
    rules: "fireside-patience",
    periods: ["daily", "weekly", "monthly"],
    score: (outcome) => outcome.score,
  },
  "riverboat-dice": {
    rules: "riverboat-dice",
    periods: ["daily", "weekly", "monthly"],
    score: (outcome) => outcome.score,
  },
  // Throttle, ping and buoy keys can land together, so a little more room.
  "sonar-dive": {
    rules: "sonar-dive",
    periods: ["daily", "weekly", "monthly"],
    score: (outcome) => outcome.score,
    burst: 6,
  },
};
