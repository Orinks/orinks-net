import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { questionBank, questionByKey, sanitizeQuestion, type BankQuestion } from "./questionBank";
import story from "../data/trivia/story.json";
import achievementDefs from "../data/trivia/achievements.json";

// --- Game rules ---
const QUESTIONS_PER_ROUND = 5;
const START_LIVES = 3;
const MAX_LIVES = 3;
const LIFE_EVERY_ROUNDS = 3; // completing every 3rd round restores a life
const BASE_POINTS = 100; // per question, multiplied by difficulty
const STREAK_BONUS = 25; // per prior consecutive correct answer
const STREAK_BONUS_CAP = 10;
const LEADERBOARD_LIMIT_MAX = 100;

// --- Anti-cheat ---
const MIN_ANSWER_MS = 900; // reading a question + 4 choices realistically takes longer
const FAST_ANSWER_FLAG = 3; // this many superhuman-fast answers flags a run as automated
const MAX_RUNS_PER_HOUR = 40; // per-player rate limit on starting runs

const TAPES = [...story.tapes].sort((a, b) => a.order - b.order);
const FINALE_UNLOCK = story.finale.unlock;

// --- Helpers ---

function dateKeyOf(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

/** ISO 8601 week, e.g. "2026-W27". Weeks start Monday. */
function weekKeyOf(now: number) {
  const date = new Date(now);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // nearest Thursday decides the week's year
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Deterministic PRNG so daily runs serve every player the same questions. */
function seededRandom(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function difficultyRange(round: number): [number, number] {
  if (round <= 2) return [1, 2];
  if (round <= 4) return [1, 3];
  if (round <= 7) return [2, 4];
  return [3, 5];
}

function runRoll(run: Doc<"triviaRuns">, salt: string): number {
  // Dailies must be deterministic so every player gets the same episode.
  return run.isDaily ? seededRandom(`${run.seed}:${salt}`)() : Math.random();
}

/**
 * Picks a theme for a round: a category with enough unasked questions to
 * carry the whole round. Returns undefined when the bank is too depleted to
 * theme (the round falls back to a mixed grab bag).
 */
function pickRoundCategory(run: Doc<"triviaRuns">, forRound: number): string | undefined {
  const asked = new Set(run.askedQuestionKeys);
  const counts = new Map<string, number>();
  for (const q of questionBank) {
    if (!asked.has(q.id)) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  }
  const viable = [...counts.entries()]
    .filter(([category, count]) => count >= QUESTIONS_PER_ROUND && category !== run.roundCategory)
    .map(([category]) => category)
    .sort(); // stable order so daily seeding is deterministic
  if (viable.length === 0) return undefined;
  const roll = runRoll(run, `category:${forRound}`);
  return viable[Math.floor(roll * viable.length)];
}

function pickQuestion(run: Doc<"triviaRuns">): BankQuestion | null {
  const asked = new Set(run.askedQuestionKeys);
  const [min, max] = difficultyRange(run.round);
  const unasked = questionBank.filter((q) => !asked.has(q.id));
  // Prefer: on-theme + in difficulty range → on-theme any difficulty →
  // in-range any theme → anything left.
  let candidates = unasked.filter(
    (q) => q.category === run.roundCategory && q.difficulty >= min && q.difficulty <= max,
  );
  if (candidates.length === 0 && run.roundCategory) {
    candidates = unasked.filter((q) => q.category === run.roundCategory);
  }
  if (candidates.length === 0) {
    candidates = unasked.filter((q) => q.difficulty >= min && q.difficulty <= max);
  }
  if (candidates.length === 0) candidates = unasked;
  if (candidates.length === 0) return null;
  const roll = runRoll(run, String(run.askedQuestionKeys.length));
  return candidates[Math.floor(roll * candidates.length)];
}

async function getPlayerByKey(ctx: QueryCtx | MutationCtx, playerKey: string) {
  return ctx.db
    .query("triviaPlayers")
    .withIndex("by_playerKey", (q) => q.eq("playerKey", playerKey))
    .unique();
}

async function getPlayerBySubject(ctx: QueryCtx | MutationCtx, subject: string) {
  return ctx.db
    .query("triviaPlayers")
    .withIndex("by_authSubject", (q) => q.eq("authSubject", subject))
    .unique();
}

/**
 * Resolves the player for a request: the signed-in account takes precedence
 * over the anonymous guest key. ensurePlayer creates/links the account row, so
 * by the time gameplay functions run the account row already exists.
 */
async function getPlayer(ctx: QueryCtx | MutationCtx, playerKey: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const account = await getPlayerBySubject(ctx, identity.subject);
    if (account) return account;
  }
  return getPlayerByKey(ctx, playerKey);
}

async function requirePlayer(ctx: QueryCtx | MutationCtx, playerKey: string) {
  const player = await getPlayer(ctx, playerKey);
  if (!player) throw new Error("Unknown player. Call ensurePlayer first.");
  return player;
}

/** A leaderboard handle from the Clerk identity claims (see the "convex" JWT template). */
function handleFromIdentity(identity: { nickname?: string; preferredUsername?: string; name?: string; email?: string }) {
  const raw =
    identity.nickname || identity.preferredUsername || identity.name || identity.email?.split("@")[0] || "Contestant";
  return cleanDisplayName(raw);
}

// Clerk validates username FORMAT but not content, so account handles still
// need screening before they appear publicly. This is a compact first-pass
// blocklist matched after leetspeak normalization; swap in a maintained
// profanity library before a wide launch. Offensive names render as anonymous.
const PROFANITY_ROOTS = [
  "nigger", "nigga", "faggot", "retard", "cunt", "fuck", "shit", "bitch",
  "rape", "nazi", "slut", "whore", "coon", "kike", "spic", "chink",
];
function normalizeForModeration(value: string): string {
  return value
    .toLowerCase()
    .replace(/[4@]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}
function safeLeaderboardName(name: string, runId: Id<"triviaRuns">): string {
  const normalized = normalizeForModeration(name);
  if (PROFANITY_ROOTS.some((root) => normalized.includes(root))) {
    return `Player ${runId.slice(-4)}`;
  }
  return name;
}

async function getActiveRunDoc(ctx: QueryCtx | MutationCtx, playerId: Id<"triviaPlayers">) {
  const runs = await ctx.db
    .query("triviaRuns")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .order("desc")
    .take(5);
  return runs.find((run) => run.status === "active") ?? null;
}

async function unlockAchievement(
  ctx: MutationCtx,
  playerId: Id<"triviaPlayers">,
  achievementKey: string,
  events: GameEvent[],
) {
  const existing = await ctx.db
    .query("triviaAchievements")
    .withIndex("by_player_achievement", (q) =>
      q.eq("playerId", playerId).eq("achievementKey", achievementKey),
    )
    .unique();
  if (existing) return;
  await ctx.db.insert("triviaAchievements", {
    playerId,
    achievementKey,
    unlockedAt: Date.now(),
  });
  const def = achievementDefs.achievements.find((a) => a.key === achievementKey);
  events.push({ type: "achievement", key: achievementKey, name: def?.name ?? achievementKey });
}

type GameEvent =
  | { type: "achievement"; key: string; name: string }
  | { type: "roundComplete"; round: number; nextCategory: string | null }
  | { type: "lifeGained"; lives: number }
  | { type: "tapeUnlocked"; id: string; title: string; order: number; total: number }
  | { type: "finaleReady" }
  | { type: "gameOver"; score: number; round: number; isPersonalBest: boolean }
  | { type: "bankExhausted" };

function publicRunState(run: Doc<"triviaRuns">) {
  return {
    runId: run._id,
    status: run.status,
    isDaily: run.isDaily,
    score: run.score,
    round: run.round,
    lives: run.lives,
    streak: run.streak,
    answeredInRound: run.answeredInRound,
    questionsPerRound: QUESTIONS_PER_ROUND,
    questionNumber: run.askedQuestionKeys.length,
    roundCategory: run.roundCategory ?? null,
  };
}

// --- Player lifecycle ---

export const ensurePlayer = mutation({
  args: { playerKey: v.string(), displayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.playerKey.length < 8 || args.playerKey.length > 64) {
      throw new Error("playerKey must be 8-64 characters");
    }
    const now = Date.now();
    const identity = await ctx.auth.getUserIdentity();

    if (identity) {
      // Signed in: the account IS the identity. Its leaderboard name mirrors
      // the Clerk handle (username, else name); a guest's typed name is ignored.
      const handle = handleFromIdentity(identity);
      const account = await getPlayerBySubject(ctx, identity.subject);
      if (account) {
        await ctx.db.patch(account._id, { displayName: handle, lastSeenAt: now });
        return { created: false, signedIn: true, displayName: handle };
      }
      // First sign-in: claim this device's guest row (and its progress) if it
      // isn't already tied to an account; otherwise start a fresh account row.
      const guest = await getPlayerByKey(ctx, args.playerKey);
      if (guest && guest.authSubject === undefined) {
        await ctx.db.patch(guest._id, { authSubject: identity.subject, displayName: handle, lastSeenAt: now });
        return { created: false, signedIn: true, migrated: true, displayName: handle };
      }
      await ctx.db.insert("triviaPlayers", {
        playerKey: identity.subject,
        authSubject: identity.subject,
        displayName: handle,
        createdAt: now,
        lastSeenAt: now,
        totalRuns: 0,
        bestScore: 0,
        deepestRound: 0,
        totalCorrect: 0,
        totalAnswered: 0,
        tapesUnlocked: [],
      });
      return { created: true, signedIn: true, displayName: handle };
    }

    // Guest (signed out): anonymous row keyed by the client-generated playerKey.
    const existing = await getPlayerByKey(ctx, args.playerKey);
    if (existing) {
      const patch: Partial<Doc<"triviaPlayers">> = { lastSeenAt: now };
      if (args.displayName !== undefined) {
        patch.displayName = cleanDisplayName(args.displayName);
      }
      await ctx.db.patch(existing._id, patch);
      return { created: false, signedIn: false, displayName: patch.displayName ?? existing.displayName };
    }
    const displayName = cleanDisplayName(args.displayName ?? `Contestant ${args.playerKey.slice(0, 4)}`);
    await ctx.db.insert("triviaPlayers", {
      playerKey: args.playerKey,
      displayName,
      createdAt: now,
      lastSeenAt: now,
      totalRuns: 0,
      bestScore: 0,
      deepestRound: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      tapesUnlocked: [],
    });
    return { created: true, signedIn: false, displayName };
  },
});

function cleanDisplayName(raw: string) {
  const cleaned = raw.replace(/[\p{C}]/gu, "").trim().slice(0, 24);
  if (cleaned.length === 0) throw new Error("Display name cannot be empty");
  return cleaned;
}

// --- Run lifecycle ---

export const startRun = mutation({
  args: { playerKey: v.string(), daily: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const now = Date.now();
    const dateKey = dateKeyOf(now);
    const isDaily = args.daily ?? false;

    const existing = await getActiveRunDoc(ctx, player._id);
    if (existing) {
      await ctx.db.patch(existing._id, { status: "abandoned", endedAt: now });
    }

    if (isDaily) {
      const todaysRuns = await ctx.db
        .query("triviaRuns")
        .withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("dateKey", dateKey))
        .collect();
      if (todaysRuns.some((run) => run.isDaily && run.status === "dead")) {
        throw new Error("Tonight's broadcast has already aired for you. Come back tomorrow!");
      }
    }

    // Rate limit: cap how many runs a player can start per hour to blunt
    // scripted farming of the leaderboard.
    const recentRuns = await ctx.db
      .query("triviaRuns")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .order("desc")
      .take(MAX_RUNS_PER_HOUR + 1);
    const startedLastHour = recentRuns.filter((run) => now - run.startedAt < 3600_000).length;
    if (startedLastHour >= MAX_RUNS_PER_HOUR) {
      throw new Error("You're starting broadcasts very fast. Take a short break and try again.");
    }

    const runId = await ctx.db.insert("triviaRuns", {
      playerId: player._id,
      seed: isDaily ? `daily-${dateKey}` : `${now.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      status: "active",
      isDaily,
      score: 0,
      round: 1,
      lives: START_LIVES,
      streak: 0,
      answeredInRound: 0,
      wrongInRound: 0,
      tapeDropped: false,
      fastAnswers: 0,
      flagged: false,
      currentQuestionServedAt: now,
      modifiers: [],
      askedQuestionKeys: [],
      dateKey,
      weekKey: weekKeyOf(now),
      startedAt: now,
    });

    const run = (await ctx.db.get(runId))!;
    const roundCategory = pickRoundCategory(run, 1);
    const question = pickQuestion({ ...run, roundCategory });
    if (!question) throw new Error("The question bank is empty.");
    await ctx.db.patch(runId, {
      roundCategory,
      currentQuestionKey: question.id,
      askedQuestionKeys: [question.id],
    });

    await ctx.db.patch(player._id, { lastSeenAt: now });
    return {
      run: { ...publicRunState(run), questionNumber: 1, roundCategory: roundCategory ?? null },
      question: sanitizeQuestion(question),
      runNumber: player.totalRuns + 1,
      epilogueActive: player.finaleCompletedAt !== undefined,
    };
  },
});

export const submitAnswer = mutation({
  args: {
    playerKey: v.string(),
    runId: v.id("triviaRuns"),
    choiceIndex: v.number(),
    clientHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    if (run.status !== "active" || !run.currentQuestionKey) throw new Error("Run is not active");
    const question = questionByKey.get(run.currentQuestionKey);
    if (!question) throw new Error("Current question missing from bank (was it removed?)");
    if (!Number.isInteger(args.choiceIndex) || args.choiceIndex < 0 || args.choiceIndex >= question.choices.length) {
      throw new Error("choiceIndex out of range");
    }

    // Anti-cheat: think time measured from the server's serve timestamp (the
    // client can't fake it). Superhuman-fast answers accumulate; enough of them
    // flag the run out of the public leaderboard. Never blocks the answer.
    const answeredAt = Date.now();
    const elapsed = answeredAt - (run.currentQuestionServedAt ?? answeredAt);
    const fastAnswers = (run.fastAnswers ?? 0) + (elapsed < MIN_ANSWER_MS ? 1 : 0);
    const flagged = (run.flagged ?? false) || fastAnswers >= FAST_ANSWER_FLAG;

    const events: GameEvent[] = [];
    const correct = args.choiceIndex === question.answer;
    let { score, streak, lives, round, answeredInRound, wrongInRound, tapeDropped, roundCategory } = run;
    let scoreDelta = 0;
    let tapesUnlocked = player.tapesUnlocked;

    if (correct) {
      scoreDelta = BASE_POINTS * question.difficulty + STREAK_BONUS * Math.min(streak, STREAK_BONUS_CAP);
      score += scoreDelta;
      streak += 1;
      if (streak === 5) await unlockAchievement(ctx, player._id, "streak-5", events);
    } else {
      lives -= 1;
      streak = 0;
      wrongInRound += 1;
    }
    answeredInRound += 1;

    const playerPatch: Partial<Doc<"triviaPlayers">> = {
      lastSeenAt: Date.now(),
      totalAnswered: player.totalAnswered + 1,
      totalCorrect: player.totalCorrect + (correct ? 1 : 0),
    };

    let nextQuestion: BankQuestion | null = null;
    const dead = lives <= 0;

    if (dead) {
      // Finalize the run and roll aggregates into the player profile.
      events.push({
        type: "gameOver",
        score,
        round,
        isPersonalBest: score > player.bestScore,
      });
      playerPatch.totalRuns = player.totalRuns + 1;
      playerPatch.bestScore = Math.max(player.bestScore, score);
      playerPatch.deepestRound = Math.max(player.deepestRound, round);
      await ctx.db.patch(args.runId, {
        status: "dead",
        score,
        streak,
        lives: 0,
        answeredInRound,
        wrongInRound,
        fastAnswers,
        flagged,
        currentQuestionKey: undefined,
        endedAt: Date.now(),
      });
      if (player.totalRuns === 0) await unlockAchievement(ctx, player._id, "first-run", events);
      if (args.clientHour !== undefined && args.clientHour >= 0 && args.clientHour < 4) {
        await unlockAchievement(ctx, player._id, "night-shift", events);
      }
    } else {
      if (answeredInRound >= QUESTIONS_PER_ROUND) {
        // Round complete: advance and pick the next round's theme.
        const completedRound = round;
        round += 1;
        roundCategory = pickRoundCategory(run, round);
        events.push({ type: "roundComplete", round: completedRound, nextCategory: roundCategory ?? null });
        if (wrongInRound === 0) await unlockAchievement(ctx, player._id, "perfect-round", events);
        if (lives === 1) await unlockAchievement(ctx, player._id, "comeback", events);
        answeredInRound = 0;
        wrongInRound = 0;
        if (round === 10) await unlockAchievement(ctx, player._id, "round-10", events);
        if (completedRound % LIFE_EVERY_ROUNDS === 0 && lives < MAX_LIVES) {
          lives += 1;
          events.push({ type: "lifeGained", lives });
        }

        // Master tape drop: at most one per run, in story order, round-gated.
        const nextTape = TAPES[tapesUnlocked.length];
        if (!tapeDropped && nextTape && round >= nextTape.minRound) {
          tapesUnlocked = [...tapesUnlocked, nextTape.id];
          playerPatch.tapesUnlocked = tapesUnlocked;
          tapeDropped = true;
          events.push({
            type: "tapeUnlocked",
            id: nextTape.id,
            title: nextTape.title,
            order: nextTape.order,
            total: TAPES.length,
          });
          if (tapesUnlocked.length === 1) await unlockAchievement(ctx, player._id, "first-tape", events);
          if (tapesUnlocked.length === TAPES.length) {
            await unlockAchievement(ctx, player._id, "all-tapes", events);
          }
        }

        if (
          tapesUnlocked.length === TAPES.length &&
          round >= FINALE_UNLOCK.minRound &&
          player.finaleCompletedAt === undefined
        ) {
          events.push({ type: "finaleReady" });
        }
      }

      nextQuestion = pickQuestion({ ...run, round, roundCategory });
      if (!nextQuestion) {
        // Ran the entire bank dry — end the run as a victory lap.
        events.push({ type: "bankExhausted" });
        events.push({ type: "gameOver", score, round, isPersonalBest: score > player.bestScore });
        playerPatch.totalRuns = player.totalRuns + 1;
        playerPatch.bestScore = Math.max(player.bestScore, score);
        playerPatch.deepestRound = Math.max(player.deepestRound, round);
        await ctx.db.patch(args.runId, {
          status: "dead",
          score,
          streak,
          lives,
          round,
          answeredInRound,
          wrongInRound,
          fastAnswers,
          flagged,
          currentQuestionKey: undefined,
          endedAt: Date.now(),
        });
      } else {
        await ctx.db.patch(args.runId, {
          score,
          streak,
          lives,
          round,
          answeredInRound,
          wrongInRound,
          tapeDropped,
          roundCategory,
          fastAnswers,
          flagged,
          currentQuestionServedAt: answeredAt,
          currentQuestionKey: nextQuestion.id,
          askedQuestionKeys: [...run.askedQuestionKeys, nextQuestion.id],
        });
      }
    }

    await ctx.db.patch(player._id, playerPatch);
    const updatedRun = (await ctx.db.get(args.runId))!;

    return {
      correct,
      correctIndex: question.answer,
      explanation: question.explanation ?? null,
      scoreDelta,
      events,
      run: publicRunState(updatedRun),
      nextQuestion: nextQuestion ? sanitizeQuestion(nextQuestion) : null,
    };
  },
});

export const abandonRun = mutation({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await getActiveRunDoc(ctx, player._id);
    if (run) await ctx.db.patch(run._id, { status: "abandoned", endedAt: Date.now() });
    return { abandoned: run !== null };
  },
});

/** Called after the client has played the finale sequence. */
export const completeFinale = mutation({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    if (player.finaleCompletedAt !== undefined) {
      return { alreadyCompleted: true, lines: story.finale.lines };
    }
    const activeRun = await getActiveRunDoc(ctx, player._id);
    const eligible =
      player.tapesUnlocked.length === TAPES.length &&
      (player.deepestRound >= FINALE_UNLOCK.minRound ||
        (activeRun !== null && activeRun.round >= FINALE_UNLOCK.minRound));
    if (!eligible) throw new Error("The signal isn't strong enough yet.");
    const events: GameEvent[] = [];
    await unlockAchievement(ctx, player._id, "channel-100", events);
    await ctx.db.patch(player._id, { finaleCompletedAt: Date.now() });
    return { alreadyCompleted: false, lines: story.finale.lines, events };
  },
});

// --- Queries ---

export const getActiveRun = query({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    if (!player) return null;
    const run = await getActiveRunDoc(ctx, player._id);
    if (!run || !run.currentQuestionKey) return null;
    const question = questionByKey.get(run.currentQuestionKey);
    if (!question) return null;
    return {
      run: publicRunState(run),
      question: sanitizeQuestion(question),
      epilogueActive: player.finaleCompletedAt !== undefined,
    };
  },
});

export const getProfile = query({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    if (!player) return null;
    const unlocked = await ctx.db
      .query("triviaAchievements")
      .withIndex("by_player_achievement", (q) => q.eq("playerId", player._id))
      .collect();
    const unlockedKeys = new Set(unlocked.map((a) => a.achievementKey));
    return {
      displayName: player.displayName,
      totalRuns: player.totalRuns,
      bestScore: player.bestScore,
      deepestRound: player.deepestRound,
      totalCorrect: player.totalCorrect,
      totalAnswered: player.totalAnswered,
      tapesUnlocked: player.tapesUnlocked.length,
      tapesTotal: TAPES.length,
      epilogueActive: player.finaleCompletedAt !== undefined,
      achievements: achievementDefs.achievements.map((def) => ({
        key: def.key,
        name: unlockedKeys.has(def.key) || !def.secret ? def.name : "???",
        description: unlockedKeys.has(def.key) || !def.secret ? def.description : "???",
        secret: def.secret,
        unlockedAt: unlocked.find((a) => a.achievementKey === def.key)?.unlockedAt ?? null,
      })),
    };
  },
});

export const getLeaderboard = query({
  args: {
    scope: v.union(v.literal("alltime"), v.literal("daily"), v.literal("weekly")),
    periodKey: v.optional(v.string()),
    limit: v.optional(v.number()),
    playerKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), LEADERBOARD_LIMIT_MAX);
    // Over-fetch by score, then keep only signed-in accounts (see filter below).
    const window = Math.min(limit * 5 + 20, 500);
    const now = Date.now();
    const viewer = args.playerKey ? await getPlayer(ctx, args.playerKey) : null;
    let runs: Doc<"triviaRuns">[];
    if (args.scope === "alltime") {
      runs = await ctx.db
        .query("triviaRuns")
        .withIndex("by_leaderboard", (q) => q.eq("status", "dead"))
        .order("desc")
        .take(window);
    } else if (args.scope === "daily") {
      const dateKey = args.periodKey ?? dateKeyOf(now);
      runs = await ctx.db
        .query("triviaRuns")
        .withIndex("by_daily_leaderboard", (q) => q.eq("status", "dead").eq("dateKey", dateKey))
        .order("desc")
        .take(window);
    } else {
      const weekKey = args.periodKey ?? weekKeyOf(now);
      runs = await ctx.db
        .query("triviaRuns")
        .withIndex("by_weekly_leaderboard", (q) => q.eq("status", "dead").eq("weekKey", weekKey))
        .order("desc")
        .take(window);
    }

    // Public leaderboards list signed-in accounts only (guests play but don't
    // rank), and offensive account handles are masked (usernames aren't
    // content-moderated by Clerk). Guests' typed names never reach here.
    const rows: Array<{
      rank: number;
      displayName: string;
      score: number;
      round: number;
      isDaily: boolean;
      isYou: boolean;
      endedAt: number;
    }> = [];
    const playerCache = new Map<Id<"triviaPlayers">, Doc<"triviaPlayers"> | null>();
    for (const run of runs) {
      if (rows.length >= limit) break;
      if (run.flagged) continue; // automated-looking runs don't rank (anti-cheat)
      let player = playerCache.get(run.playerId);
      if (player === undefined) {
        player = await ctx.db.get(run.playerId);
        playerCache.set(run.playerId, player);
      }
      if (!player || player.authSubject === undefined) continue; // accounts only
      rows.push({
        rank: rows.length + 1,
        displayName: safeLeaderboardName(player.displayName, run._id),
        score: run.score,
        round: run.round,
        isDaily: run.isDaily,
        isYou: viewer !== null && run.playerId === viewer._id,
        endedAt: run.endedAt ?? run.startedAt,
      });
    }
    return rows;
  },
});

/** Unlocked story content only — tape text is never sent before it's earned. */
export const getStory = query({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    const unlockedIds = new Set(player?.tapesUnlocked ?? []);
    const epilogueActive = player?.finaleCompletedAt !== undefined;
    return {
      showTitle: story.show.title,
      tapesTotal: TAPES.length,
      tapes: TAPES.filter((tape) => unlockedIds.has(tape.id)).map((tape) => ({
        id: tape.id,
        order: tape.order,
        title: tape.title,
        text: tape.text,
      })),
      finaleLines: epilogueActive ? story.finale.lines : null,
      epilogueLines: epilogueActive ? story.epilogueLines : null,
      epilogueActive,
    };
  },
});

// --- Test utilities (admin-only; not callable from clients) ---

export const wipePlayer = internalMutation({
  args: { playerKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    if (!player) return { wiped: false };
    const runs = await ctx.db
      .query("triviaRuns")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .collect();
    for (const run of runs) await ctx.db.delete(run._id);
    const achievements = await ctx.db
      .query("triviaAchievements")
      .withIndex("by_player_achievement", (q) => q.eq("playerId", player._id))
      .collect();
    for (const achievement of achievements) await ctx.db.delete(achievement._id);
    await ctx.db.delete(player._id);
    return { wiped: true, runs: runs.length, achievements: achievements.length };
  },
});
