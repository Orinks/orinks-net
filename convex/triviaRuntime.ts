import achievementDefs from "../data/trivia/achievements.json";
import story from "../data/trivia/story.json";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { boostByKey } from "./boosts";
import { maskDisplayName } from "./moderation";
import { mutatorByKey, type MutatorDef } from "./mutators";
import { questionByKey, sanitizeQuestion } from "./questionBank";

export const START_LIVES = 3;
export const MAX_LIVES = 3;
export const LIFE_EVERY_ROUNDS = 3;
export const BASE_POINTS = 100;
export const STREAK_BONUS = 25;
export const STREAK_BONUS_CAP = 10;
export const LEADERBOARD_LIMIT_MAX = 100;
export const AMPLIFIER_STREAK_BONUS = 40;
export const NIGHT_OWL_MULTIPLIER = 1.5;
export const DOUBLE_BROADCAST_MULTIPLIER = 2;
export const DOUBLE_BROADCAST_LIFE_COST = 2;
export const DEEP_CUTS_MULTIPLIER = 1.75;
export const SPARE_FUSE_POINTS = 250;
export const STATIC_FILTER_ELIMINATIONS = 2;
export const SIGNAL_CAP = 3;
export const SIGNAL_EVERY_STREAK = 3;
export const BOSS_CALL_EVERY_ROUNDS = 3;
export const BOSS_REWARD_POINTS = 300;
export const BOSS_CALLERS = [
  { key: "archivist", name: "The Archivist" },
  { key: "night-owl", name: "The Night Owl" },
] as const;
export const FLAT_RATES_BASE_MULTIPLIER = 2;
export const HEAVY_ROTATION_MULTIPLIER = 1.5;
export const THIN_ICE_START_LIVES = 2;
export const MIN_ANSWER_MS = 900;
export const FAST_ANSWER_FLAG = 3;
export const MAX_RUNS_PER_HOUR = 40;
export const TAPES = [...story.tapes].sort((left, right) => left.order - right.order);
export const FINALE_UNLOCK = story.finale.unlock;

const QUESTIONS_PER_ROUND = 5;
const LONG_HAUL_QUESTIONS_PER_ROUND = 7;

export type GameEvent =
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

export function mutatorOf(
  run: Pick<Doc<"triviaRuns">, "mutatorKey">,
): MutatorDef | null {
  return run.mutatorKey ? (mutatorByKey.get(run.mutatorKey) ?? null) : null;
}

export function questionsPerRoundOf(
  run: Pick<Doc<"triviaRuns">, "mutatorKey">,
): number {
  return run.mutatorKey === "long-haul"
    ? LONG_HAUL_QUESTIONS_PER_ROUND
    : QUESTIONS_PER_ROUND;
}

function bossPublicState(run: Doc<"triviaRuns">) {
  if (!run.bossCall) return null;
  const caller = BOSS_CALLERS.find((candidate) => candidate.key === run.bossCall!.caller);
  const question =
    run.bossCall.phase === "question"
      ? questionByKey.get(run.bossCall.questionKey)
      : undefined;
  return {
    caller: run.bossCall.caller,
    callerName: caller?.name ?? "A caller",
    phase: run.bossCall.phase,
    question: question ? sanitizeQuestion(question) : null,
  };
}

export async function getPlayerByKey(
  ctx: QueryCtx | MutationCtx,
  playerKey: string,
) {
  return ctx.db
    .query("triviaPlayers")
    .withIndex("by_playerKey", (query) => query.eq("playerKey", playerKey))
    .unique();
}

export async function getPlayerBySubject(
  ctx: QueryCtx | MutationCtx,
  subject: string,
) {
  return ctx.db
    .query("triviaPlayers")
    .withIndex("by_authSubject", (query) => query.eq("authSubject", subject))
    .unique();
}

export async function getPlayer(ctx: QueryCtx | MutationCtx, playerKey: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const account = await getPlayerBySubject(ctx, identity.subject);
    if (account) return account;
  }
  return getPlayerByKey(ctx, playerKey);
}

export async function requirePlayer(
  ctx: QueryCtx | MutationCtx,
  playerKey: string,
) {
  const player = await getPlayer(ctx, playerKey);
  if (!player) throw new Error("Unknown player. Call ensurePlayer first.");
  return player;
}

export function safeLeaderboardName(name: string, idForMask: string): string {
  return maskDisplayName(name, idForMask, "Player");
}

export async function getActiveRunDoc(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"triviaPlayers">,
) {
  const runs = await ctx.db
    .query("triviaRuns")
    .withIndex("by_playerId", (query) => query.eq("playerId", playerId))
    .order("desc")
    .take(5);
  return runs.find((run) => run.status === "active") ?? null;
}

export async function unlockAchievement(
  ctx: MutationCtx,
  playerId: Id<"triviaPlayers">,
  achievementKey: string,
  events: GameEvent[],
) {
  const existing = await ctx.db
    .query("triviaAchievements")
    .withIndex("by_player_achievement", (query) =>
      query.eq("playerId", playerId).eq("achievementKey", achievementKey),
    )
    .unique();
  if (existing) return;
  await ctx.db.insert("triviaAchievements", {
    playerId,
    achievementKey,
    unlockedAt: Date.now(),
  });
  const definition = achievementDefs.achievements.find(
    (achievement) => achievement.key === achievementKey,
  );
  events.push({
    type: "achievement",
    key: achievementKey,
    name: definition?.name ?? achievementKey,
  });
}

export function publicRunState(run: Doc<"triviaRuns">) {
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
      ? {
          key: mutator.key,
          name: mutator.name,
          rules: mutator.rules,
          intro: mutator.intro,
        }
      : null,
    dateKey: run.dateKey,
  };
}

export function boostPublicState(run: Doc<"triviaRuns">) {
  const owned = run.modifiers.flatMap((key) => {
    const definition = boostByKey.get(key);
    if (!definition) return [];
    return [
      {
        key,
        name: definition.name,
        kind: definition.kind,
        rules: definition.rules,
        chargesLeft:
          definition.kind === "charges" ? (run.boostCharges?.[key] ?? 0) : null,
      },
    ];
  });
  const offer =
    run.pendingBoostOffer?.map((key) => {
      const definition = boostByKey.get(key)!;
      return {
        key,
        name: definition.name,
        tagline: definition.tagline,
        rules: definition.rules,
        kind: definition.kind,
      };
    }) ?? null;
  return {
    owned,
    offer,
    activeRoundBoost: run.activeRoundBoost ?? null,
    eliminatedChoices: run.eliminatedChoices ?? [],
    eliminatedBy: run.eliminatedBy ?? null,
  };
}
