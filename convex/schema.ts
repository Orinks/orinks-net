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
    .index("by_displayName", ["displayName"]),

  // One row per run. The server picks and stores currentQuestionKey so the
  // client never sees answers ahead of time; askedQuestionKeys prevents
  // repeats within a run. dateKey/weekKey enable daily and weekly leaderboards.
  triviaRuns: defineTable({
    playerId: v.id("triviaPlayers"),
    seed: v.string(),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("abandoned")),
    isDaily: v.boolean(),
    score: v.number(),
    round: v.number(),
    lives: v.number(),
    streak: v.number(),
    answeredInRound: v.number(),
    wrongInRound: v.number(),
    tapeDropped: v.boolean(),
    roundCategory: v.optional(v.string()), // theme of the current round

    modifiers: v.array(v.string()),
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
    .index("by_daily_leaderboard", ["status", "dateKey", "score"])
    .index("by_weekly_leaderboard", ["status", "weekKey", "score"]),

  // Unlocks only — achievement definitions live in data/trivia/achievements.json.
  triviaAchievements: defineTable({
    playerId: v.id("triviaPlayers"),
    achievementKey: v.string(),
    unlockedAt: v.number(),
  }).index("by_player_achievement", ["playerId", "achievementKey"]),
});
