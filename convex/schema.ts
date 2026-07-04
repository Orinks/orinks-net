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

  // Synced from data/trivia/questions/*.json (repo is the authoring source of
  // truth). correctIndex and explanation must never be returned by public
  // queries — answers are checked server-side so leaderboard scores stay honest.
  triviaQuestions: defineTable({
    questionKey: v.string(),
    minigame: v.union(v.literal("general-trivia"), v.literal("name-that-tune")),
    prompt: v.string(),
    choices: v.array(v.string()),
    correctIndex: v.number(),
    explanation: v.optional(v.string()),
    category: v.string(),
    difficulty: v.number(),
    promptAudioPath: v.optional(v.string()),
    tuneId: v.optional(v.string()),
    active: v.boolean(),
  })
    .index("by_questionKey", ["questionKey"])
    .index("by_minigame_difficulty", ["minigame", "difficulty"]),

  // playerKey is an anonymous client-generated key for now; when real auth is
  // added, map the auth subject onto the same row and keep the key as a legacy
  // alias. Aggregate stats live here so profile pages don't scan runs.
  triviaPlayers: defineTable({
    playerKey: v.string(),
    displayName: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    totalRuns: v.number(),
    bestScore: v.number(),
    deepestRound: v.number(),
    totalCorrect: v.number(),
    totalAnswered: v.number(),
  })
    .index("by_playerKey", ["playerKey"])
    .index("by_displayName", ["displayName"]),

  // One row per run. The server picks and stores currentQuestionId so the
  // client never sees answers ahead of time; askedQuestionKeys prevents
  // repeats within a run. dateKey/weekKey enable daily and weekly leaderboards.
  triviaRuns: defineTable({
    playerId: v.id("triviaPlayers"),
    seed: v.string(),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("abandoned")),
    score: v.number(),
    round: v.number(),
    lives: v.number(),
    streak: v.number(),
    modifiers: v.array(v.string()),
    currentQuestionId: v.optional(v.id("triviaQuestions")),
    askedQuestionKeys: v.array(v.string()),
    dateKey: v.string(),
    weekKey: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_playerId", ["playerId"])
    .index("by_leaderboard", ["status", "score"])
    .index("by_daily_leaderboard", ["status", "dateKey", "score"])
    .index("by_weekly_leaderboard", ["status", "weekKey", "score"]),

  // Unlocks only — achievement definitions live in data/trivia/achievements.json.
  triviaAchievements: defineTable({
    playerId: v.id("triviaPlayers"),
    achievementKey: v.string(),
    unlockedAt: v.number(),
  }).index("by_player_achievement", ["playerId", "achievementKey"]),
});
