import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { questionByKey, sanitizeQuestion } from "./questionBank";
import { getOrCreateDailyEpisode, selectionPoolForRun } from "./triviaDailyEpisodes";
import { dateKeyOf, weekKeyOf } from "./triviaDeterminism";
import {
  boostPublicState,
  getActiveRunDoc,
  getPlayerByKey,
  getPlayerBySubject,
  MAX_RUNS_PER_HOUR,
  publicRunState,
  questionsPerRoundOf,
  requirePlayer,
  START_LIVES,
  THIN_ICE_START_LIVES,
} from "./triviaRuntime";
import { pickQuestion, pickRoundCategory } from "./triviaSelection";

function cleanDisplayName(raw: string) {
  const cleaned = raw.replace(/[\p{C}]/gu, "").trim().slice(0, 24);
  if (cleaned.length === 0) throw new Error("Display name cannot be empty");
  return cleaned;
}

function handleFromIdentity(identity: {
  nickname?: string;
  preferredUsername?: string;
  name?: string;
  email?: string;
}) {
  const raw =
    identity.nickname ||
    identity.preferredUsername ||
    identity.name ||
    identity.email?.split("@")[0] ||
    "Contestant";
  return cleanDisplayName(raw);
}

export async function ensurePlayerHandler(
  ctx: MutationCtx,
  args: { playerKey: string; displayName?: string },
) {
  if (args.playerKey.length < 8 || args.playerKey.length > 64) {
    throw new Error("playerKey must be 8-64 characters");
  }
  const now = Date.now();
  const identity = await ctx.auth.getUserIdentity();

  if (identity) {
    const handle = handleFromIdentity(identity);
    const account = await getPlayerBySubject(ctx, identity.subject);
    if (account) {
      await ctx.db.patch(account._id, { displayName: handle, lastSeenAt: now });
      return { created: false, signedIn: true, displayName: handle };
    }
    const guest = await getPlayerByKey(ctx, args.playerKey);
    if (guest && guest.authSubject === undefined) {
      await ctx.db.patch(guest._id, {
        authSubject: identity.subject,
        displayName: handle,
        lastSeenAt: now,
      });
      return {
        created: false,
        signedIn: true,
        migrated: true,
        displayName: handle,
      };
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

  const existing = await getPlayerByKey(ctx, args.playerKey);
  if (existing) {
    const patch: Partial<Doc<"triviaPlayers">> = { lastSeenAt: now };
    if (args.displayName !== undefined) {
      patch.displayName = cleanDisplayName(args.displayName);
    }
    await ctx.db.patch(existing._id, patch);
    return {
      created: false,
      signedIn: false,
      displayName: patch.displayName ?? existing.displayName,
    };
  }
  const displayName = cleanDisplayName(
    args.displayName ?? `Contestant ${args.playerKey.slice(0, 4)}`,
  );
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
}

export async function startRunHandler(
  ctx: MutationCtx,
  args: { playerKey: string; daily?: boolean },
) {
  const player = await requirePlayer(ctx, args.playerKey);
  const now = Date.now();
  const dateKey = dateKeyOf(now);
  const isDaily = args.daily ?? false;

  if (isDaily) {
    const todaysRuns = await ctx.db
      .query("triviaRuns")
      .withIndex("by_player_date", (query) =>
        query.eq("playerId", player._id).eq("dateKey", dateKey),
      )
      .collect();
    const activeDaily = todaysRuns.find(
      (run) => run.isDaily && run.status === "active",
    );
    if (activeDaily) {
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
    if (todaysRuns.some((run) => run.isDaily && run.status !== "active")) {
      throw new Error("Tonight's broadcast has already aired for you. Come back tomorrow!");
    }
  }

  const existing = await getActiveRunDoc(ctx, player._id);
  if (existing) {
    await ctx.db.patch(existing._id, { status: "abandoned", endedAt: now });
  }

  const recentRuns = await ctx.db
    .query("triviaRuns")
    .withIndex("by_playerId", (query) => query.eq("playerId", player._id))
    .order("desc")
    .take(MAX_RUNS_PER_HOUR + 1);
  const startedLastHour = recentRuns.filter(
    (run) => now - run.startedAt < 3_600_000,
  ).length;
  if (startedLastHour >= MAX_RUNS_PER_HOUR) {
    throw new Error("You're starting broadcasts very fast. Take a short break and try again.");
  }

  const dailyEpisode = isDaily
    ? await getOrCreateDailyEpisode(ctx, dateKey, now)
    : null;
  const mutatorKey = dailyEpisode?.mutatorKey;
  const runId = await ctx.db.insert("triviaRuns", {
    playerId: player._id,
    seed:
      dailyEpisode?.seed ??
      `${now.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    ...(dailyEpisode
      ? {
          dailyEpisodeId: dailyEpisode._id,
          contentVersion: dailyEpisode.contentVersion,
          rulesVersion: dailyEpisode.rulesVersion,
        }
      : {}),
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
  const selection = await selectionPoolForRun(ctx, run);
  const roundCategory = pickRoundCategory(
    run,
    selection.questions,
    1,
    questionsPerRoundOf(run),
    selection.rulesVersion,
  );
  const question = pickQuestion(
    { ...run, roundCategory },
    selection.questions,
    selection.usePlannedOrder,
    selection.rulesVersion,
  );
  if (!question) throw new Error("The question bank is empty.");
  await ctx.db.patch(runId, {
    roundCategory,
    currentQuestionKey: question.id,
    askedQuestionKeys: [question.id],
  });

  await ctx.db.patch(player._id, { lastSeenAt: now });
  return {
    run: {
      ...publicRunState(run),
      questionNumber: 1,
      roundCategory: roundCategory ?? null,
    },
    boosts: boostPublicState(run),
    question: sanitizeQuestion(question),
    runNumber: player.totalRuns + 1,
    epilogueActive: player.finaleCompletedAt !== undefined,
    resumed: false,
  };
}
