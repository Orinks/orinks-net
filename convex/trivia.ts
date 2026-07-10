import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { questionBank, questionByKey, sanitizeQuestion, type BankQuestion } from "./questionBank";
import { boostByKey, rollBoostOffer } from "./boosts";
import { mutatorByKey, mutatorCatalog, type MutatorDef } from "./mutators";
import { maskDisplayName } from "./moderation";
import { dateKeyOf, runRoll, seededRandom, weekKeyOf } from "./triviaDeterminism";
import {
  pickBossQuestion,
  pickDeadAirQuestion,
  pickQuestion,
  pickRoundCategory,
} from "./triviaSelection";
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

// --- Signal Boost tuning (catalog lives in data/trivia/boosts.json) ---
const AMPLIFIER_STREAK_BONUS = 40; // replaces STREAK_BONUS
const NIGHT_OWL_MULTIPLIER = 1.5; // difficulty 4-5 questions
const DOUBLE_BROADCAST_MULTIPLIER = 2; // and wrong answers cost 2 lives
const DOUBLE_BROADCAST_LIFE_COST = 2;
const DEEP_CUTS_MULTIPLIER = 1.75; // and the difficulty band shifts up a tier
const SPARE_FUSE_POINTS = 250; // consolation when already at max lives
const STATIC_FILTER_ELIMINATIONS = 2;

// --- Signal Strength (lifeline economy) tuning ---
const SIGNAL_CAP = 3;
const SIGNAL_EVERY_STREAK = 3; // every 3rd consecutive correct answer

// --- Boss Call tuning ---
const BOSS_CALL_EVERY_ROUNDS = 3;
const BOSS_REWARD_POINTS = 300;
const BOSS_CALLERS = [
  { key: "archivist", name: "The Archivist" },
  { key: "night-owl", name: "The Night Owl" },
] as const;

// --- Daily mutator tuning (catalog lives in data/trivia/mutators.json) ---
const FLAT_RATES_BASE_MULTIPLIER = 2; // and the streak bonus is 0 that night
const HEAVY_ROTATION_MULTIPLIER = 1.5; // and the difficulty band shifts up
const THIN_ICE_START_LIVES = 2;
const LONG_HAUL_QUESTIONS_PER_ROUND = 7;

function mutatorOf(run: Pick<Doc<"triviaRuns">, "mutatorKey">): MutatorDef | null {
  return run.mutatorKey ? (mutatorByKey.get(run.mutatorKey) ?? null) : null;
}

function questionsPerRoundOf(run: Pick<Doc<"triviaRuns">, "mutatorKey">): number {
  return run.mutatorKey === "long-haul" ? LONG_HAUL_QUESTIONS_PER_ROUND : QUESTIONS_PER_ROUND;
}

// --- Anti-cheat ---
const MIN_ANSWER_MS = 900; // reading a question + 4 choices realistically takes longer
const FAST_ANSWER_FLAG = 3; // this many superhuman-fast answers flags a run as automated
const MAX_RUNS_PER_HOUR = 40; // per-player rate limit on starting runs

const TAPES = [...story.tapes].sort((a, b) => a.order - b.order);
const FINALE_UNLOCK = story.finale.unlock;

/** Client-safe boss call state (the question only while it's answerable). */
function bossPublicState(run: Doc<"triviaRuns">) {
  if (!run.bossCall) return null;
  const caller = BOSS_CALLERS.find((c) => c.key === run.bossCall!.caller);
  const question =
    run.bossCall.phase === "question" ? questionByKey.get(run.bossCall.questionKey) : undefined;
  return {
    caller: run.bossCall.caller,
    callerName: caller?.name ?? "A caller",
    phase: run.bossCall.phase,
    question: question ? sanitizeQuestion(question) : null,
  };
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
// need screening before they appear publicly. The shared moderation module
// (obscenity's English preset plus a hate-figure list) masks offensive names
// as anonymous at display time.
function safeLeaderboardName(name: string, idForMask: string): string {
  return maskDisplayName(name, idForMask, "Player");
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
  | { type: "boostOffer" }
  | { type: "boostChosen"; key: string; name: string }
  | { type: "boostTriggered"; key: string; name: string; detail: string }
  | { type: "deadAir" }
  | { type: "deadAirSurvived" }
  | { type: "bossCall"; caller: string; name: string }
  | { type: "bossRewardChosen"; reward: string; detail: string }
  | { type: "signalGained"; strength: number }
  | { type: "lifeGained"; lives: number }
  | { type: "tapeUnlocked"; id: string; title: string; order: number; total: number }
  | { type: "finaleReady" }
  | { type: "gameOver"; score: number; round: number; isPersonalBest: boolean }
  | { type: "bankExhausted" };

function publicRunState(run: Doc<"triviaRuns">) {
  const mutator = mutatorOf(run);
  return {
    runId: run._id,
    status: run.status,
    isDaily: run.isDaily,
    score: run.score,
    round: run.round,
    lives: run.lives,
    streak: run.streak,
    answeredInRound: run.answeredInRound,
    questionsPerRound: questionsPerRoundOf(run),
    questionNumber: run.askedQuestionKeys.length,
    roundCategory: run.roundCategory ?? null,
    drafting: run.pendingBoostOffer !== undefined,
    deadAir: run.deadAirPending === true,
    bossCall: bossPublicState(run),
    signalStrength: run.signalStrength ?? 0,
    mutator: mutator
      ? { key: mutator.key, name: mutator.name, rules: mutator.rules, intro: mutator.intro }
      : null,
    // The run's own night (share snippets must name it, not "today" — a run
    // resumed after midnight still belongs to the night it started).
    dateKey: run.dateKey,
  };
}

/** Client-safe boost state: owned boosts, the pending offer, filter marks. */
function boostPublicState(run: Doc<"triviaRuns">) {
  const owned = run.modifiers.flatMap((key) => {
    const def = boostByKey.get(key);
    if (!def) return [];
    return [{
      key,
      name: def.name,
      kind: def.kind,
      rules: def.rules,
      chargesLeft: def.kind === "charges" ? run.boostCharges?.[key] ?? 0 : null,
    }];
  });
  const offer =
    run.pendingBoostOffer?.map((key) => {
      const def = boostByKey.get(key)!;
      return { key, name: def.name, tagline: def.tagline, rules: def.rules, kind: def.kind };
    }) ?? null;
  return {
    owned,
    offer,
    activeRoundBoost: run.activeRoundBoost ?? null,
    eliminatedChoices: run.eliminatedChoices ?? [],
    eliminatedBy: run.eliminatedBy ?? null,
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

    if (isDaily) {
      const todaysRuns = await ctx.db
        .query("triviaRuns")
        .withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("dateKey", dateKey))
        .collect();
      // The daily seed is deterministic, so reseeding an in-progress attempt
      // would deal the same questions again — a free preview. Resume instead.
      const activeDaily = todaysRuns.find((run) => run.isDaily && run.status === "active");
      if (activeDaily) {
        // Resume mid-draft (the persisted offer, never re-rolled) or
        // mid-question — whichever state the attempt was left in.
        const question = activeDaily.currentQuestionKey
          ? questionByKey.get(activeDaily.currentQuestionKey)
          : undefined;
        if (activeDaily.pendingBoostOffer || activeDaily.bossCall || question) {
          await ctx.db.patch(player._id, { lastSeenAt: now });
          return {
            run: publicRunState(activeDaily),
            boosts: boostPublicState(activeDaily),
            question: question ? sanitizeQuestion(question) : null,
            runNumber: player.totalRuns + 1,
            epilogueActive: player.finaleCompletedAt !== undefined,
            resumed: true,
          };
        }
      }
      // One attempt per night: dead OR abandoned consumes it. Walking away
      // from an attempt must not grant a fresh look at the same seed.
      if (todaysRuns.some((run) => run.isDaily && run.status !== "active")) {
        throw new Error("Tonight's broadcast has already aired for you. Come back tomorrow!");
      }
    }

    const existing = await getActiveRunDoc(ctx, player._id);
    if (existing) {
      await ctx.db.patch(existing._id, { status: "abandoned", endedAt: now });
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

    // Tonight's broadcast condition: seeded from the date, same for everyone.
    const mutatorKey = isDaily
      ? mutatorCatalog[Math.floor(seededRandom(`mutator:${dateKey}`)() * mutatorCatalog.length)].key
      : undefined;

    const runId = await ctx.db.insert("triviaRuns", {
      playerId: player._id,
      seed: isDaily ? `daily-${dateKey}` : `${now.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      status: "active",
      isDaily,
      mutatorKey,
      score: 0,
      round: 1,
      lives: mutatorKey === "thin-ice" ? THIN_ICE_START_LIVES : START_LIVES,
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
    const roundCategory = pickRoundCategory(run, questionBank, 1, questionsPerRoundOf(run));
    const question = pickQuestion({ ...run, roundCategory }, questionBank);
    if (!question) throw new Error("The question bank is empty.");
    await ctx.db.patch(runId, {
      roundCategory,
      currentQuestionKey: question.id,
      askedQuestionKeys: [question.id],
    });

    await ctx.db.patch(player._id, { lastSeenAt: now });
    return {
      run: { ...publicRunState(run), questionNumber: 1, roundCategory: roundCategory ?? null },
      boosts: boostPublicState(run),
      question: sanitizeQuestion(question),
      runNumber: player.totalRuns + 1,
      epilogueActive: player.finaleCompletedAt !== undefined,
      resumed: false,
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
    if (run.eliminatedChoices?.includes(args.choiceIndex)) {
      throw new Error("That choice was eliminated");
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

    const ownedBoosts = new Set(run.modifiers);
    const mutator = mutatorOf(run);
    let signalStrength = run.signalStrength ?? 0;
    const roundBoost =
      run.activeRoundBoost && run.activeRoundBoost.round === round ? run.activeRoundBoost.key : null;

    if (correct) {
      let base = BASE_POINTS * question.difficulty;
      if (ownedBoosts.has("night-owl-rates") && question.difficulty >= 4) {
        base *= NIGHT_OWL_MULTIPLIER;
        events.push({
          type: "boostTriggered",
          key: "night-owl-rates",
          name: "Night Owl Rates",
          detail: "Night Owl Rates paid overtime on that one.",
        });
      }
      if (mutator?.key === "flat-rates") base *= FLAT_RATES_BASE_MULTIPLIER;
      if (mutator?.key === "heavy-rotation") base *= HEAVY_ROTATION_MULTIPLIER;
      const streakBonus =
        mutator?.key === "flat-rates"
          ? 0
          : ownedBoosts.has("amplifier")
            ? AMPLIFIER_STREAK_BONUS
            : STREAK_BONUS;
      let delta = base + streakBonus * Math.min(streak, STREAK_BONUS_CAP);
      if (roundBoost === "double-broadcast") {
        delta *= DOUBLE_BROADCAST_MULTIPLIER;
        events.push({
          type: "boostTriggered",
          key: "double-broadcast",
          name: "Double Broadcast",
          detail: "Double Broadcast doubled it.",
        });
      } else if (roundBoost === "deep-cuts") {
        delta *= DEEP_CUTS_MULTIPLIER;
        events.push({
          type: "boostTriggered",
          key: "deep-cuts",
          name: "Deep Cuts",
          detail: "Deep Cuts premium applied.",
        });
      }
      scoreDelta = Math.round(delta);
      score += scoreDelta;
      streak += 1;
      if (streak % SIGNAL_EVERY_STREAK === 0 && signalStrength < SIGNAL_CAP) {
        signalStrength += 1;
        events.push({ type: "signalGained", strength: signalStrength });
      }
      if (streak === 5) await unlockAchievement(ctx, player._id, "streak-5", events);
    } else {
      let lifeCost = roundBoost === "double-broadcast" ? DOUBLE_BROADCAST_LIFE_COST : 1;
      if (ownedBoosts.has("second-wind") && wrongInRound === 0) {
        lifeCost = 0;
        events.push({
          type: "boostTriggered",
          key: "second-wind",
          name: "Second Wind",
          detail: "Second Wind absorbed the miss. No life lost.",
        });
      }
      lives -= lifeCost;
      if (ownedBoosts.has("signal-lock") && streak >= 2) {
        streak = Math.floor(streak / 2);
        events.push({
          type: "boostTriggered",
          key: "signal-lock",
          name: "Signal Lock",
          detail: `Signal Lock held your streak at ${streak}.`,
        });
      } else {
        streak = 0;
      }
      wrongInRound += 1;
    }
    answeredInRound += 1;

    const playerPatch: Partial<Doc<"triviaPlayers">> = {
      lastSeenAt: Date.now(),
      totalAnswered: player.totalAnswered + 1,
      totalCorrect: player.totalCorrect + (correct ? 1 : 0),
    };

    // Dead Air resolution: a correct redemption answer revives the run.
    if (run.deadAirPending && correct) {
      lives = 1;
      events.push({ type: "deadAirSurvived" });
    }

    let nextQuestion: BankQuestion | null = null;
    const dead = lives <= 0;
    // Dead Air entry: the last life just went and the chance is unspent —
    // one seeded, hardest-available question decides whether the run ends.
    const deadAirQuestion =
      dead && !(run.deadAirUsed ?? false) ? pickDeadAirQuestion(run, questionBank) : null;

    if (dead && deadAirQuestion) {
      events.push({ type: "deadAir" });
      nextQuestion = deadAirQuestion;
      await ctx.db.patch(args.runId, {
        score,
        streak,
        signalStrength,
        lives: 0,
        answeredInRound,
        wrongInRound,
        fastAnswers,
        flagged,
        deadAirUsed: true,
        deadAirPending: true,
        currentQuestionServedAt: answeredAt,
        currentQuestionKey: deadAirQuestion.id,
        askedQuestionKeys: [...run.askedQuestionKeys, deadAirQuestion.id],
        eliminatedChoices: undefined, eliminatedBy: undefined,
      });
    } else if (dead) {
      // Finalize the run and roll aggregates into the player profile.
      events.push({
        type: "gameOver",
        score,
        round,
        isPersonalBest: !flagged && score > player.bestScore,
      });
      playerPatch.totalRuns = player.totalRuns + 1;
      // A flagged (automated-looking) run counts as played but never as a
      // best: it's excluded from leaderboards, so it can't set records either.
      if (!flagged) {
        if (score > player.bestScore) {
          playerPatch.bestScore = score;
          playerPatch.bestRunRound = round;
          playerPatch.bestRunAt = Date.now();
        }
        playerPatch.deepestRound = Math.max(player.deepestRound, round);
      }
      await ctx.db.patch(args.runId, {
        status: "dead",
        score,
        streak,
        lives: 0,
        answeredInRound,
        wrongInRound,
        fastAnswers,
        flagged,
        deadAirPending: undefined,
        currentQuestionKey: undefined,
        endedAt: Date.now(),
      });
      if (player.totalRuns === 0) await unlockAchievement(ctx, player._id, "first-run", events);
      if (args.clientHour !== undefined && args.clientHour >= 0 && args.clientHour < 4) {
        await unlockAchievement(ctx, player._id, "night-shift", events);
      }
    } else {
      const roundJustCompleted = answeredInRound >= questionsPerRoundOf(run);
      if (roundJustCompleted) {
        // Round complete: advance. The next theme is NOT picked here — the
        // player drafts a Signal Boost first, and chooseBoost opens the round
        // (so the theme is announced when it's actually true).
        const completedRound = round;
        round += 1;
        roundCategory = undefined;
        events.push({ type: "roundComplete", round: completedRound, nextCategory: null });
        if (wrongInRound === 0) await unlockAchievement(ctx, player._id, "perfect-round", events);
        if (lives === 1) await unlockAchievement(ctx, player._id, "comeback", events);
        answeredInRound = 0;
        wrongInRound = 0;
        if (round === 10) await unlockAchievement(ctx, player._id, "round-10", events);
        const lifeCadence =
          ownedBoosts.has("tune-up") || run.mutatorKey === "thin-ice" ? 2 : LIFE_EVERY_ROUNDS;
        if (completedRound % lifeCadence === 0 && lives < MAX_LIVES) {
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

      if (roundJustCompleted) {
        const betweenRounds: Partial<Doc<"triviaRuns">> = {
          score,
          streak,
          signalStrength,
          lives,
          round,
          answeredInRound,
          wrongInRound,
          tapeDropped,
          roundCategory: undefined,
          fastAnswers,
          flagged,
          deadAirPending: undefined,
          currentQuestionKey: undefined,
          currentQuestionServedAt: answeredAt,
          eliminatedChoices: undefined, eliminatedBy: undefined,
          // A round-scoped boost from the previous draft has expired by now.
          activeRoundBoost:
            run.activeRoundBoost && run.activeRoundBoost.round >= round ? run.activeRoundBoost : undefined,
        };
        const completedRoundNumber = round - 1;
        const bossQuestion =
          completedRoundNumber % BOSS_CALL_EVERY_ROUNDS === 0
            ? pickBossQuestion(run, questionBank, completedRoundNumber)
            : null;
        if (bossQuestion) {
          // Every 3rd round: a caller rings the show with one bonus question
          // (no lives at stake). The draft follows once the call resolves.
          const roll = runRoll(run, `boss-caller:${completedRoundNumber}`);
          const caller = BOSS_CALLERS[Math.floor(roll * BOSS_CALLERS.length)];
          events.push({ type: "bossCall", caller: caller.key, name: caller.name });
          await ctx.db.patch(args.runId, {
            ...betweenRounds,
            bossCall: {
              caller: caller.key,
              questionKey: bossQuestion.id,
              servedAt: answeredAt,
              phase: "question",
            },
            askedQuestionKeys: [...run.askedQuestionKeys, bossQuestion.id],
          });
        } else {
          // Between rounds: post the Signal Boost offer instead of a question.
          // The offer is seeded so daily players all see the same three; it
          // persists on the run and is never re-rolled (no offer fishing).
          const offer = rollBoostOffer(run.modifiers, (salt) => runRoll(run, salt), round);
          events.push({ type: "boostOffer" });
          await ctx.db.patch(args.runId, { ...betweenRounds, pendingBoostOffer: offer });
        }
      } else {
        nextQuestion = pickQuestion({ ...run, round, roundCategory }, questionBank);
        if (!nextQuestion) {
          // Ran the entire bank dry — end the run as a victory lap.
          events.push({ type: "bankExhausted" });
          events.push({ type: "gameOver", score, round, isPersonalBest: !flagged && score > player.bestScore });
          playerPatch.totalRuns = player.totalRuns + 1;
          if (!flagged) {
            if (score > player.bestScore) {
              playerPatch.bestScore = score;
              playerPatch.bestRunRound = round;
              playerPatch.bestRunAt = Date.now();
            }
            playerPatch.deepestRound = Math.max(player.deepestRound, round);
          }
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
            deadAirPending: undefined,
            currentQuestionKey: undefined,
            endedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(args.runId, {
            score,
            streak,
            signalStrength,
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
            eliminatedChoices: undefined, eliminatedBy: undefined,
            deadAirPending: undefined,
          });
        }
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
      boosts: boostPublicState(updatedRun),
      nextQuestion: nextQuestion ? sanitizeQuestion(nextQuestion) : null,
    };
  },
});

/** Takes the drafted boost and opens the next round (theme + first question). */
export const chooseBoost = mutation({
  args: { playerKey: v.string(), runId: v.id("triviaRuns"), boostKey: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    if (run.status !== "active" || !run.pendingBoostOffer) throw new Error("No boost offer to choose from");
    if (!run.pendingBoostOffer.includes(args.boostKey)) throw new Error("That boost isn't in tonight's offer");
    const def = boostByKey.get(args.boostKey);
    if (!def) throw new Error("Unknown boost");
    const now = Date.now();
    const events: GameEvent[] = [];

    let lives = run.lives;
    let score = run.score;
    const patch: Partial<Doc<"triviaRuns">> = { pendingBoostOffer: undefined };
    if (def.kind === "instant") {
      // Spare Fuse: immediate life, or points when already topped up.
      if (lives < MAX_LIVES) {
        lives += 1;
        patch.lives = lives;
        events.push({ type: "lifeGained", lives });
      } else {
        score += SPARE_FUSE_POINTS;
        patch.score = score;
        events.push({
          type: "boostTriggered",
          key: def.key,
          name: def.name,
          detail: `Already at full lives — ${SPARE_FUSE_POINTS} points instead.`,
        });
      }
    } else {
      // Instant boosts are consumed on the spot and never join the loadout.
      patch.modifiers = [...run.modifiers, args.boostKey];
    }
    if (def.kind === "charges") {
      patch.boostCharges = {
        ...(run.boostCharges ?? {}),
        [args.boostKey]: (run.boostCharges?.[args.boostKey] ?? 0) + (def.charges ?? 1),
      };
    }
    if (def.kind === "nextRound") {
      patch.activeRoundBoost = { key: args.boostKey, round: run.round };
    }
    events.push({ type: "boostChosen", key: def.key, name: def.name });

    // Open the round: pick the theme and serve the first question. The
    // anti-cheat clock starts here, so draft time never counts as think time.
    const draftedRun = { ...run, ...patch } as Doc<"triviaRuns">;
    const roundCategory = pickRoundCategory(
      draftedRun,
      questionBank,
      run.round,
      questionsPerRoundOf(draftedRun),
    );
    const question = pickQuestion({ ...draftedRun, roundCategory }, questionBank);
    if (!question) {
      // Bank ran dry during the draft — victory lap, same as submitAnswer.
      const flagged = run.flagged ?? false;
      events.push({ type: "bankExhausted" });
      events.push({ type: "gameOver", score, round: run.round, isPersonalBest: !flagged && score > player.bestScore });
      const playerPatch: Partial<Doc<"triviaPlayers">> = {
        lastSeenAt: now,
        totalRuns: player.totalRuns + 1,
      };
      if (!flagged) {
        if (score > player.bestScore) {
          playerPatch.bestScore = score;
          playerPatch.bestRunRound = run.round;
          playerPatch.bestRunAt = now;
        }
        playerPatch.deepestRound = Math.max(player.deepestRound, run.round);
      }
      await ctx.db.patch(args.runId, { ...patch, status: "dead", currentQuestionKey: undefined, endedAt: now });
      await ctx.db.patch(player._id, playerPatch);
      const deadRun = (await ctx.db.get(args.runId))!;
      return { run: publicRunState(deadRun), boosts: boostPublicState(deadRun), question: null, events };
    }
    await ctx.db.patch(args.runId, {
      ...patch,
      roundCategory,
      currentQuestionKey: question.id,
      askedQuestionKeys: [...run.askedQuestionKeys, question.id],
      currentQuestionServedAt: now,
      eliminatedChoices: undefined, eliminatedBy: undefined,
    });
    await ctx.db.patch(player._id, { lastSeenAt: now });
    const updated = (await ctx.db.get(args.runId))!;
    return {
      run: publicRunState(updated),
      boosts: boostPublicState(updated),
      question: sanitizeQuestion(question),
      events,
    };
  },
});

/** Producer's Whisper: spend 1 signal to eliminate ONE wrong choice. */
export const useSignal = mutation({
  args: { playerKey: v.string(), runId: v.id("triviaRuns") },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    const targetKey =
      run.bossCall?.phase === "question" ? run.bossCall.questionKey : run.currentQuestionKey;
    if (run.status !== "active" || !targetKey) throw new Error("No question on the air");
    const signal = run.signalStrength ?? 0;
    if (signal <= 0) throw new Error("No signal strength stored");
    // One elimination effect per question: Whisper and Static Filter are
    // mutually exclusive, whichever lands first.
    if (run.eliminatedChoices && run.eliminatedChoices.length > 0) {
      throw new Error("An elimination is already applied to this question");
    }
    const question = questionByKey.get(targetKey);
    if (!question) throw new Error("Current question missing from bank");
    const wrongs = question.choices.map((_, index) => index).filter((index) => index !== question.answer);
    const roll = runRoll(run, `whisper:${targetKey}`);
    const eliminated = wrongs[Math.floor(roll * wrongs.length)];
    await ctx.db.patch(args.runId, {
      eliminatedChoices: [eliminated],
      eliminatedBy: "whisper",
      signalStrength: signal - 1,
    });
    return { eliminated, signalLeft: signal - 1 };
  },
});

/** Activates a charge boost mid-question. v1: Static Filter only. */
export const useBoost = mutation({
  args: { playerKey: v.string(), runId: v.id("triviaRuns"), boostKey: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    // The filter works on the regular question or a Boss Call question.
    const filterTargetKey =
      run.bossCall?.phase === "question" ? run.bossCall.questionKey : run.currentQuestionKey;
    if (run.status !== "active" || !filterTargetKey) throw new Error("No question on the air");
    if (args.boostKey !== "static-filter") throw new Error("That boost can't be activated");
    const charges = run.boostCharges?.[args.boostKey] ?? 0;
    if (charges <= 0) throw new Error("No uses left");
    if (run.eliminatedChoices && run.eliminatedChoices.length > 0) {
      throw new Error("An elimination is already applied to this question");
    }
    const question = questionByKey.get(filterTargetKey);
    if (!question) throw new Error("Current question missing from bank");
    const wrongs = question.choices.map((_, index) => index).filter((index) => index !== question.answer);
    // Seeded picks: daily players who filter the same question see the same
    // eliminations.
    const eliminated: number[] = [];
    for (let pick = 0; pick < STATIC_FILTER_ELIMINATIONS && wrongs.length > 0; pick++) {
      const roll = runRoll(run, `filter:${filterTargetKey}:${pick}`);
      eliminated.push(...wrongs.splice(Math.floor(roll * wrongs.length), 1));
    }
    eliminated.sort((a, b) => a - b);
    await ctx.db.patch(args.runId, {
      eliminatedChoices: eliminated,
      eliminatedBy: "static-filter",
      boostCharges: { ...(run.boostCharges ?? {}), [args.boostKey]: charges - 1 },
    });
    return { eliminated, chargesLeft: charges - 1 };
  },
});

/** Answers the Boss Call question. No lives at stake either way. */
export const answerBossCall = mutation({
  args: { playerKey: v.string(), runId: v.id("triviaRuns"), choiceIndex: v.number() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    if (run.status !== "active" || run.bossCall?.phase !== "question") {
      throw new Error("No caller on the line");
    }
    const question = questionByKey.get(run.bossCall.questionKey);
    if (!question) throw new Error("Caller question missing from bank");
    if (!Number.isInteger(args.choiceIndex) || args.choiceIndex < 0 || args.choiceIndex >= question.choices.length) {
      throw new Error("choiceIndex out of range");
    }
    if (run.eliminatedChoices?.includes(args.choiceIndex)) {
      throw new Error("That choice was eliminated");
    }

    // Same anti-cheat clock as regular questions. Caller answers touch
    // neither streak nor signal strength (documented: no earning here, so
    // no signalGained event can be dropped by the client's caller path).
    const answeredAt = Date.now();
    const elapsed = answeredAt - run.bossCall.servedAt;
    const fastAnswers = (run.fastAnswers ?? 0) + (elapsed < MIN_ANSWER_MS ? 1 : 0);
    const flagged = (run.flagged ?? false) || fastAnswers >= FAST_ANSWER_FLAG;

    const events: GameEvent[] = [];
    const correct = args.choiceIndex === question.answer;
    if (correct) {
      await ctx.db.patch(args.runId, {
        fastAnswers,
        flagged,
        bossCall: { ...run.bossCall, phase: "reward" },
        eliminatedChoices: undefined, eliminatedBy: undefined,
      });
    } else {
      // The caller hangs up; the commercial break (draft) proceeds as normal.
      const offer = rollBoostOffer(run.modifiers, (salt) => runRoll(run, salt), run.round);
      events.push({ type: "boostOffer" });
      await ctx.db.patch(args.runId, {
        fastAnswers,
        flagged,
        bossCall: undefined,
        pendingBoostOffer: offer,
        eliminatedChoices: undefined, eliminatedBy: undefined,
      });
    }
    await ctx.db.patch(player._id, {
      lastSeenAt: answeredAt,
      totalAnswered: player.totalAnswered + 1,
      totalCorrect: player.totalCorrect + (correct ? 1 : 0),
    });
    const updated = (await ctx.db.get(args.runId))!;
    // AnswerResult-compatible so the client reuses the feedback flow.
    return {
      correct,
      correctIndex: question.answer,
      explanation: question.explanation ?? null,
      scoreDelta: 0,
      events,
      run: publicRunState(updated),
      boosts: boostPublicState(updated),
      nextQuestion: null,
    };
  },
});

/** Resolves a won Boss Call: one reward, then the round's draft proceeds. */
export const chooseBossReward = mutation({
  args: {
    playerKey: v.string(),
    runId: v.id("triviaRuns"),
    reward: v.union(v.literal("life"), v.literal("points"), v.literal("filter")),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.playerId !== player._id) throw new Error("Run not found");
    if (run.status !== "active" || run.bossCall?.phase !== "reward") {
      throw new Error("No reward waiting");
    }
    const events: GameEvent[] = [];
    const patch: Partial<Doc<"triviaRuns">> = { bossCall: undefined };
    if (args.reward === "life") {
      if (run.lives < MAX_LIVES) {
        patch.lives = run.lives + 1;
        events.push({ type: "lifeGained", lives: run.lives + 1 });
      } else {
        patch.score = run.score + SPARE_FUSE_POINTS;
        events.push({
          type: "bossRewardChosen",
          reward: "life",
          detail: `Already at full lives — ${SPARE_FUSE_POINTS} points instead. Score ${run.score + SPARE_FUSE_POINTS}.`,
        });
      }
    } else if (args.reward === "points") {
      patch.score = run.score + BOSS_REWARD_POINTS;
      events.push({
        type: "bossRewardChosen",
        reward: "points",
        detail: `Plus ${BOSS_REWARD_POINTS} points. Score ${run.score + BOSS_REWARD_POINTS}.`,
      });
    } else {
      const chargesAfter = (run.boostCharges?.["static-filter"] ?? 0) + 1;
      patch.modifiers = run.modifiers.includes("static-filter")
        ? run.modifiers
        : [...run.modifiers, "static-filter"];
      patch.boostCharges = { ...(run.boostCharges ?? {}), "static-filter": chargesAfter };
      events.push({
        type: "bossRewardChosen",
        reward: "filter",
        detail: `Static Filter charge added. Static Filter: ${chargesAfter} ${chargesAfter === 1 ? "use" : "uses"} left.`,
      });
    }
    // The commercial break still happens: post the round's draft offer.
    const offer = rollBoostOffer(
      patch.modifiers ?? run.modifiers,
      (salt) => runRoll(run, salt),
      run.round,
    );
    events.push({ type: "boostOffer" });
    await ctx.db.patch(args.runId, { ...patch, pendingBoostOffer: offer });
    await ctx.db.patch(player._id, { lastSeenAt: Date.now() });
    const updated = (await ctx.db.get(args.runId))!;
    return { run: publicRunState(updated), boosts: boostPublicState(updated), events };
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
    if (!run) return null;
    if (run.pendingBoostOffer || run.bossCall) {
      // Mid-draft or mid-boss-call: the client re-enters the same screen
      // (the offer and the call both persist on the run).
      return {
        run: publicRunState(run),
        boosts: boostPublicState(run),
        question: null,
        epilogueActive: player.finaleCompletedAt !== undefined,
      };
    }
    if (!run.currentQuestionKey) return null;
    const question = questionByKey.get(run.currentQuestionKey);
    if (!question) return null;
    return {
      run: publicRunState(run),
      boosts: boostPublicState(run),
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
    const rows: Array<{
      rank: number;
      displayName: string;
      score: number;
      round: number;
      isDaily: boolean;
      isYou: boolean;
      endedAt: number;
    }> = [];

    if (args.scope === "alltime") {
      // All-time is one row per player by construction: read profiles by best
      // score instead of scanning runs. A run scan has a fixed window, and one
      // grinder's runs could fill it and starve everyone else off the board.
      // bestScore never includes flagged runs, and 0 means "no ranked score".
      const players = await ctx.db
        .query("triviaPlayers")
        .withIndex("by_bestScore", (q) => q.gt("bestScore", 0))
        .order("desc")
        .take(window);
      for (const player of players) {
        if (rows.length >= limit) break;
        if (player.authSubject === undefined) continue; // accounts only
        rows.push({
          rank: rows.length + 1,
          displayName: safeLeaderboardName(player.displayName, player._id),
          score: player.bestScore,
          round: player.bestRunRound ?? player.deepestRound,
          isDaily: false,
          isYou: viewer !== null && player._id === viewer._id,
          endedAt: player.bestRunAt ?? player.lastSeenAt,
        });
      }
      return rows;
    }

    let runs: Doc<"triviaRuns">[];
    if (args.scope === "daily") {
      // The daily board is the daily CHALLENGE board: everyone plays the same
      // seeded episode, so free-play runs don't belong on it.
      const dateKey = args.periodKey ?? dateKeyOf(now);
      runs = await ctx.db
        .query("triviaRuns")
        .withIndex("by_daily_leaderboard", (q) =>
          q.eq("status", "dead").eq("isDaily", true).eq("dateKey", dateKey),
        )
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
    // One entry per player: runs arrive sorted by score descending, so the
    // first run seen for a player is their best for the period.
    const playerCache = new Map<Id<"triviaPlayers">, Doc<"triviaPlayers"> | null>();
    const rankedPlayers = new Set<Id<"triviaPlayers">>();
    for (const run of runs) {
      if (rows.length >= limit) break;
      if (run.flagged) continue; // automated-looking runs don't rank (anti-cheat)
      if (rankedPlayers.has(run.playerId)) continue;
      let player = playerCache.get(run.playerId);
      if (player === undefined) {
        player = await ctx.db.get(run.playerId);
        playerCache.set(run.playerId, player);
      }
      if (!player || player.authSubject === undefined) continue; // accounts only
      rankedPlayers.add(run.playerId);
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

/** Forces a mutator onto the active run (tests/admin only — normally date-seeded). */
export const setMutator = internalMutation({
  args: { playerKey: v.string(), mutatorKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    if (!player) throw new Error("Unknown player");
    const run = await getActiveRunDoc(ctx, player._id);
    if (!run) throw new Error("No active run");
    if (!mutatorByKey.has(args.mutatorKey)) throw new Error("Unknown mutator");
    await ctx.db.patch(run._id, { mutatorKey: args.mutatorKey });
    return { set: args.mutatorKey };
  },
});

/** Grants a boost to the active run outside the draft (tests/admin only). */
export const grantBoost = internalMutation({
  args: { playerKey: v.string(), boostKey: v.string() },
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.playerKey);
    if (!player) throw new Error("Unknown player");
    const run = await getActiveRunDoc(ctx, player._id);
    if (!run) throw new Error("No active run");
    const def = boostByKey.get(args.boostKey);
    if (!def) throw new Error("Unknown boost");
    const patch: Partial<Doc<"triviaRuns">> = {};
    if (def.kind !== "instant") patch.modifiers = [...run.modifiers, args.boostKey];
    if (def.kind === "charges") {
      patch.boostCharges = {
        ...(run.boostCharges ?? {}),
        [args.boostKey]: (run.boostCharges?.[args.boostKey] ?? 0) + (def.charges ?? 1),
      };
    }
    if (def.kind === "nextRound") {
      patch.activeRoundBoost = { key: args.boostKey, round: run.round };
    }
    await ctx.db.patch(run._id, patch);
    return { granted: args.boostKey };
  },
});

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
