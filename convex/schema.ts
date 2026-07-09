import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  buildNotificationSubscriptions: defineTable({
    endpoint: v.string(),
    expirationTime: v.optional(v.number()),
    keys: v.object({
      auth: v.string(),
      p256dh: v.string(),
    }),
    product: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_endpoint_product", ["endpoint", "product"]),
  siteCounters: defineTable({
    name: v.string(),
    count: v.number(),
    environmentKey: v.optional(v.string()),
    period: v.optional(v.union(v.literal("lifetime"), v.literal("daily"))),
    dateKey: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_name", ["name"]),

  // --- Music trivia roguelite ---

  // The question bank is NOT a table: convex/questionBank.ts imports the JSON
  // from data/trivia/questions/ directly into the server bundle, so answers
  // never leave the server and question edits ship with a normal deploy.

  // playerKey is the anonymous client-generated key (guest play). When a player
  // signs in with Clerk, their Clerk subject is stored in authSubject on the
  // same row (claiming the guest's progress), and displayName is seeded from
  // their account. Aggregate stats live here so profile pages don't scan runs.
  triviaPlayers: defineTable({
    playerKey: v.string(),
    authSubject: v.optional(v.string()), // Clerk user id once signed in
    displayName: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    totalRuns: v.number(),
    bestScore: v.number(),
    // Snapshot of the run that set bestScore, shown on the all-time board.
    // Optional: rows predating the fields fall back to deepestRound/lastSeenAt.
    bestRunRound: v.optional(v.number()),
    bestRunAt: v.optional(v.number()),
    deepestRound: v.number(),
    totalCorrect: v.number(),
    totalAnswered: v.number(),
    // Story progress: tape ids from data/trivia/story.json, unlocked in
    // order. A set finaleCompletedAt switches the host to epilogue barks.
    tapesUnlocked: v.array(v.string()),
    finaleCompletedAt: v.optional(v.number()),
  })
    .index("by_authSubject", ["authSubject"])
    .index("by_playerKey", ["playerKey"])
    .index("by_displayName", ["displayName"])
    .index("by_bestScore", ["bestScore"]),

  // One row per run. The server picks and stores currentQuestionKey so the
  // client never sees answers ahead of time; askedQuestionKeys prevents
  // repeats within a run. dateKey/weekKey enable daily and weekly leaderboards.
  triviaRuns: defineTable({
    playerId: v.id("triviaPlayers"),
    seed: v.string(),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("abandoned")),
    isDaily: v.boolean(),
    // Daily broadcast condition (mutator), seeded from the date — identical
    // for every player that night. Free-play runs have none.
    mutatorKey: v.optional(v.string()),
    score: v.number(),
    round: v.number(),
    lives: v.number(),
    streak: v.number(),
    answeredInRound: v.number(),
    wrongInRound: v.number(),
    tapeDropped: v.boolean(),
    roundCategory: v.optional(v.string()), // theme of the current round

    // Anti-cheat: when the current question was served (server clock) and how
    // many answers came back implausibly fast. A flagged run is excluded from
    // public leaderboards (a bot answering in milliseconds can't rank).
    currentQuestionServedAt: v.optional(v.number()),
    fastAnswers: v.optional(v.number()),
    flagged: v.optional(v.boolean()),

    // Signal Boosts: modifiers holds owned boost keys. A non-null
    // pendingBoostOffer means the run is drafting (between rounds, no
    // current question); the offer persists so resume never re-rolls it.
    modifiers: v.array(v.string()),
    // Dead Air: once per run, losing the last life serves one redemption
    // question instead of ending the run. deadAirPending marks the current
    // question as that redemption; deadAirUsed means the chance is spent.
    deadAirUsed: v.optional(v.boolean()),
    deadAirPending: v.optional(v.boolean()),
    pendingBoostOffer: v.optional(v.array(v.string())),
    boostCharges: v.optional(v.record(v.string(), v.number())),
    activeRoundBoost: v.optional(v.object({ key: v.string(), round: v.number() })),
    eliminatedChoices: v.optional(v.array(v.number())),
    currentQuestionKey: v.optional(v.string()),
    askedQuestionKeys: v.array(v.string()),
    dateKey: v.string(),
    weekKey: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_playerId", ["playerId"])
    .index("by_player_date", ["playerId", "dateKey"])
    .index("by_leaderboard", ["status", "score"])
    .index("by_daily_leaderboard", ["status", "isDaily", "dateKey", "score"])
    .index("by_weekly_leaderboard", ["status", "weekKey", "score"]),

  // Unlocks only — achievement definitions live in data/trivia/achievements.json.
  triviaAchievements: defineTable({
    playerId: v.id("triviaPlayers"),
    achievementKey: v.string(),
    unlockedAt: v.number(),
  }).index("by_player_achievement", ["playerId", "achievementKey"]),

  // --- Freight Fate online ---

  freightFateDrivers: defineTable({
    driverId: v.string(),
    displayName: v.string(),
    // The Clerk account (getUserIdentity().subject) that owns this driver.
    // One driver per account; the setup page provisions it after sign-in.
    // Optional so pre-existing prototype rows validate until they are reset.
    authSubject: v.optional(v.string()),
    // public: listed on the live drivers board; unlisted: profile reachable
    // by URL only; private: nothing shown anywhere.
    visibility: v.union(v.literal("public"), v.literal("private"), v.literal("unlisted")),
    driverTokenHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_driver_id", ["driverId"])
    .index("by_auth_subject", ["authSubject"]),
  // Live "who's on duty" board: one row per driver holding only the latest
  // heartbeat. Rows older than the board TTL are treated as offline and
  // pruned on the next write; no history is kept by design.
  freightFatePresence: defineTable({
    driverId: v.string(),
    activity: v.string(),
    detail: v.string(),
    updatedAt: v.number(),
  })
    .index("by_driver_id", ["driverId"])
    .index("by_updated", ["updatedAt"]),
  freightFateDriverEvents: defineTable({
    driverId: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    summary: v.string(),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_driver", ["driverId"])
    .index("by_driver_event", ["driverId", "eventId"]),
});
