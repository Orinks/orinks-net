/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { questionBank, questionByKey, type BankQuestion } from "./questionBank";
import {
  DAILY_EPISODE_CONTENT_VERSION,
  DAILY_EPISODE_RULES_VERSION,
} from "./triviaVersions";

const modules = import.meta.glob("./**/*.ts");

const PLAYER = "test-player-0001";

// Fake ONLY Date (not timers) so we can simulate human think time between the
// server serving a question and the answer coming back — the anti-cheat's
// signal. Leaving setTimeout/setInterval real keeps convex-test's async intact.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: 1_700_000_000_000 });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advance the fake clock to simulate a human pausing to read and answer. */
const HUMAN_THINK_MS = 2000;
function think(ms = HUMAN_THINK_MS) {
  vi.setSystemTime(Date.now() + ms);
}

function setup() {
  return convexTest(schema, modules);
}

async function newPlayer(t: ReturnType<typeof convexTest>, key = PLAYER, name = "Tester") {
  return t.mutation(api.trivia.ensurePlayer, { playerKey: key, displayName: name });
}

// Accept either the base test client or a withIdentity accessor (both expose .mutation).
type Caller = { mutation: ReturnType<typeof convexTest>["mutation"] };

/** Completes a pending Signal Boost draft by taking the given (or first) offered boost. */
async function draftBoost(
  t: Caller,
  playerKey: string,
  runId: string,
  result: { boosts: { offer: Array<{ key: string }> | null } },
  boostKey?: string,
) {
  const key = boostKey ?? result.boosts.offer![0].key;
  return t.mutation(api.trivia.chooseBoost, { playerKey, runId: runId as never, boostKey: key });
}

/** Answers wrong (through the Dead Air redemption) until the run ends. */
async function loseRun(t: Caller, playerKey: string, runId: string, startKey: string) {
  let key = startKey;
  let result;
  for (let i = 0; i < 12; i++) {
    result = await answer(t, playerKey, runId, key, false);
    if (result.run.status === "dead") return result;
    if (result.nextQuestion) {
      key = result.nextQuestion.key;
    } else if (result.run.drafting) {
      const drafted = await draftBoost(t, playerKey, runId, result);
      key = drafted.question!.key;
    }
  }
  throw new Error("Run refused to die");
}

/** Answer the current question; pass correctly=true/false to steer the run. */
async function answer(
  t: Caller,
  playerKey: string,
  runId: string,
  questionKey: string,
  correctly: boolean,
  thinkMs = HUMAN_THINK_MS,
) {
  think(thinkMs); // simulate think time before submitting (default = human-plausible)
  const question = questionByKey.get(questionKey)!;
  const choiceIndex = correctly
    ? question.answer
    : (question.answer + 1) % question.choices.length;
  return t.mutation(api.trivia.submitAnswer, {
    playerKey,
    runId: runId as never,
    choiceIndex,
  });
}

describe("daily runs", () => {
  test("atomically reuses one versioned frozen episode and links every new run", async () => {
    const t = setup();
    await newPlayer(t, "daily-plan-00001", "First");
    await newPlayer(t, "daily-plan-00002", "Second");

    const [first, second] = await Promise.all([
      t.mutation(api.trivia.startRun, { playerKey: "daily-plan-00001", daily: true }),
      t.mutation(api.trivia.startRun, { playerKey: "daily-plan-00002", daily: true }),
    ]);
    const stored = await t.run(async (ctx) => ({
      episodes: await ctx.db.query("dailyEpisodes").collect(),
      runs: await ctx.db.query("triviaRuns").collect(),
    }));

    expect(stored.episodes).toHaveLength(1);
    const episode = stored.episodes[0];
    expect(episode.dateKey).toBe("2023-11-14");
    expect(episode.contentVersion).toBe(DAILY_EPISODE_CONTENT_VERSION);
    expect(episode.rulesVersion).toBe(DAILY_EPISODE_RULES_VERSION);
    expect(episode.candidates).toHaveLength(questionBank.length);
    expect(episode.candidates.every((candidate) =>
      candidate.choiceOrder.join(",") === "0,1,2,3",
    )).toBe(true);

    const dailyRuns = stored.runs.filter((run) => run.isDaily);
    expect(dailyRuns).toHaveLength(2);
    for (const run of dailyRuns) {
      expect(run.dailyEpisodeId).toBe(episode._id);
      expect(run.contentVersion).toBe(episode.contentVersion);
      expect(run.rulesVersion).toBe(episode.rulesVersion);
      expect(run.seed).toBe(episode.seed);
      expect(run.mutatorKey).toBe(episode.mutatorKey);
    }
    expect(first.question!.key).toBe(second.question!.key);
    expect(first.question!.choices).toEqual(questionByKey.get(first.question!.key)!.choices);
  });

  test("reuses the persisted candidate order after candidates are added or reordered", async () => {
    const t = setup();
    await newPlayer(t, "daily-freeze-0001", "Before");
    await newPlayer(t, "daily-freeze-0002", "After");
    const first = await t.mutation(api.trivia.startRun, {
      playerKey: "daily-freeze-0001",
      daily: true,
    });
    const before = await t.run(async (ctx) => ctx.db.query("dailyEpisodes").first());
    const originalOrder = [...questionBank];
    const servedQuestion = questionByKey.get(first.question!.key)!;
    const servedIndex = questionBank.findIndex(
      (question) => question.id === servedQuestion.id,
    );
    const lateCandidate: BankQuestion = {
      ...questionBank[0],
      id: "late-daily-candidate",
      category: "Music",
      difficulty: 1,
      prompt: "This candidate arrived after the episode froze.",
      choices: ["A", "B", "C", "D"],
      answer: 0,
    };

    try {
      questionByKey.delete(servedQuestion.id);
      questionBank.splice(servedIndex, 1, {
        ...servedQuestion,
        prompt: "This edit must not alter an episode that already aired.",
        choices: ["Edited A", "Edited B", "Edited C", "Edited D"],
        answer: 3,
      });
      questionBank.reverse();
      questionBank.unshift(lateCandidate);
      questionByKey.set(lateCandidate.id, lateCandidate);
      const second = await t.mutation(api.trivia.startRun, {
        playerKey: "daily-freeze-0002",
        daily: true,
      });
      const after = await t.run(async (ctx) => ctx.db.query("dailyEpisodes").collect());

      expect(after).toHaveLength(1);
      expect(after[0]._id).toBe(before!._id);
      expect(after[0].candidates).toEqual(before!.candidates);
      expect(after[0].candidates.some((candidate) => candidate.questionId === lateCandidate.id)).toBe(
        false,
      );
      expect(second.question!.key).toBe(first.question!.key);
      expect(second.question).toEqual(first.question);
    } finally {
      questionBank.splice(0, questionBank.length, ...originalOrder);
      questionByKey.set(servedQuestion.id, servedQuestion);
      questionByKey.delete(lateCandidate.id);
    }
  });

  test("resumes a legacy daily run that has no episode or version fields", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    await answer(t, PLAYER, first.run.runId, first.question!.key, true);
    await t.run(async (ctx) => {
      await ctx.db.patch(first.run.runId, {
        dailyEpisodeId: undefined,
        contentVersion: undefined,
        rulesVersion: undefined,
        seed: "daily-2023-11-14",
      });
    });

    const resumed = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    expect(resumed.resumed).toBe(true);
    expect(resumed.run.runId).toBe(first.run.runId);
    expect(resumed.run.questionNumber).toBe(2);
  });

  test("daily runs serve identical question sequences to different players", async () => {
    const t = setup();
    await newPlayer(t, "daily-player-0001", "Early Bird");
    await newPlayer(t, "daily-player-0002", "Night Owl");

    const runA = await t.mutation(api.trivia.startRun, { playerKey: "daily-player-0001", daily: true });
    const runB = await t.mutation(api.trivia.startRun, { playerKey: "daily-player-0002", daily: true });
    expect(runA.question!.key).toBe(runB.question!.key);

    // Sequences stay aligned even when one player answers wrong.
    const a2 = await answer(t, "daily-player-0001", runA.run.runId, runA.question!.key, true);
    const b2 = await answer(t, "daily-player-0002", runB.run.runId, runB.question!.key, false);
    expect(a2.nextQuestion!.key).toBe(b2.nextQuestion!.key);
  });

  test("starting the daily again resumes the in-progress attempt", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    expect(first.resumed).toBe(false);
    await answer(t, PLAYER, first.run.runId, first.question!.key, true);

    // Same seed, same night: the server must hand back the same run
    // mid-episode, never a fresh look at a deterministic question sequence.
    const again = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    expect(again.resumed).toBe(true);
    expect(again.run.runId).toBe(first.run.runId);
    expect(again.run.questionNumber).toBe(2);
    expect(again.run.score).toBeGreaterThan(0);
  });

  test("an abandoned daily consumes the night's attempt", async () => {
    const t = setup();
    await newPlayer(t);
    await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    await t.mutation(api.trivia.abandonRun, { playerKey: PLAYER });
    await expect(
      t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true }),
    ).rejects.toThrow(/already aired/);
  });

  test("abandoning the daily via a free run also consumes the attempt", async () => {
    const t = setup();
    await newPlayer(t);
    await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    // Starting a free run abandons the active daily server-side.
    await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await expect(
      t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true }),
    ).rejects.toThrow(/already aired/);
  });

  test("a finished daily cannot be replayed the same day", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    await loseRun(t, PLAYER, start.run.runId, start.question!.key);
    await expect(
      t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true }),
    ).rejects.toThrow(/already aired/);
  });
});

describe("leaderboards", () => {
  test("finished account runs rank by score across scopes", async () => {
    const t = setup();
    const alpha = t.withIdentity({ subject: "user_alpha", nickname: "Alpha" });
    const beta = t.withIdentity({ subject: "user_beta", nickname: "Beta" });
    await alpha.mutation(api.trivia.ensurePlayer, { playerKey: "leader-player-0001" });
    await beta.mutation(api.trivia.ensurePlayer, { playerKey: "leader-player-0002" });

    // Alpha scores twice (with a streak bonus) then dies; Beta scores once
    // then dies, so Alpha always outranks Beta on every board.
    const runA = await alpha.mutation(api.trivia.startRun, { playerKey: "leader-player-0001" });
    let key = runA.question!.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(alpha, "leader-player-0001", runA.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    await loseRun(alpha, "leader-player-0001", runA.run.runId, key);
    const runB = await beta.mutation(api.trivia.startRun, { playerKey: "leader-player-0002" });
    key = runB.question!.key;
    const scored = await answer(beta, "leader-player-0002", runB.run.runId, key, true);
    await loseRun(beta, "leader-player-0002", runB.run.runId, scored.nextQuestion!.key);

    // Free-play runs rank on the all-time and weekly boards, not the daily
    // (the daily board is reserved for the daily challenge).
    for (const scope of ["alltime", "weekly"] as const) {
      const board = await t.query(api.trivia.getLeaderboard, { scope });
      expect(board.length).toBe(2);
      expect(board[0].displayName).toBe("Alpha");
      expect(board[0].rank).toBe(1);
      expect(board[0].score).toBeGreaterThan(board[1].score);
    }
  });

  test("the daily board lists daily-challenge runs only", async () => {
    const t = setup();
    const daily = t.withIdentity({ subject: "user_daily", nickname: "DailyDiva" });
    const free = t.withIdentity({ subject: "user_free", nickname: "FreePlayer" });
    await daily.mutation(api.trivia.ensurePlayer, { playerKey: "daily-board-00001" });
    await free.mutation(api.trivia.ensurePlayer, { playerKey: "daily-board-00002" });

    const dailyRun = await daily.mutation(api.trivia.startRun, { playerKey: "daily-board-00001", daily: true });
    await loseRun(daily, "daily-board-00001", dailyRun.run.runId, dailyRun.question!.key);
    const freeRun = await free.mutation(api.trivia.startRun, { playerKey: "daily-board-00002" });
    const scored = await answer(free, "daily-board-00002", freeRun.run.runId, freeRun.question!.key, true);
    await loseRun(free, "daily-board-00002", freeRun.run.runId, scored.nextQuestion!.key);

    const board = await t.query(api.trivia.getLeaderboard, { scope: "daily" });
    expect(board.length).toBe(1);
    expect(board[0].displayName).toBe("DailyDiva");
    // The free-play run still ranks on the broader boards.
    const alltime = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(alltime.some((row) => row.displayName === "FreePlayer")).toBe(true);
  });

  test("a player with several finished runs gets one entry: their best", async () => {
    const t = setup();
    const grinder = t.withIdentity({ subject: "user_grinder", nickname: "Grinder" });
    await grinder.mutation(api.trivia.ensurePlayer, { playerKey: "grind-key-000001" });

    // Run 1: two correct answers, then out.
    const runA = await grinder.mutation(api.trivia.startRun, { playerKey: "grind-key-000001" });
    let key = runA.question!.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(grinder, "grind-key-000001", runA.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    const endA = await loseRun(grinder, "grind-key-000001", runA.run.runId, key);
    const bestScore = endA.run.score;

    // Run 2: dies immediately with a lower score.
    const runB = await grinder.mutation(api.trivia.startRun, { playerKey: "grind-key-000001" });
    await loseRun(grinder, "grind-key-000001", runB.run.runId, runB.question!.key);

    // Free-play runs: dedup applies on the all-time and weekly boards (the
    // daily board only lists daily-challenge runs, one per player by rule).
    for (const scope of ["alltime", "weekly"] as const) {
      const board = await t.query(api.trivia.getLeaderboard, { scope });
      const mine = board.filter((row) => row.displayName === "Grinder");
      expect(mine.length).toBe(1);
      expect(mine[0].score).toBe(bestScore);
    }
  });

  test("guests do not appear on the public leaderboard", async () => {
    const t = setup();
    await newPlayer(t, "guest-leader-0001", "SomeGuest");
    const start = await t.mutation(api.trivia.startRun, { playerKey: "guest-leader-0001" });
    await loseRun(t, "guest-leader-0001", start.run.runId, start.question!.key);
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.length).toBe(0);
  });

  test("offensive account handles are masked on the leaderboard", async () => {
    const t = setup();
    const troll = t.withIdentity({ subject: "user_troll", nickname: "n1gger" });
    await troll.mutation(api.trivia.ensurePlayer, { playerKey: "troll-key-000001" });
    const run = await troll.mutation(api.trivia.startRun, { playerKey: "troll-key-000001" });
    const scored = await answer(troll, "troll-key-000001", run.run.runId, run.question!.key, true);
    await loseRun(troll, "troll-key-000001", run.run.runId, scored.nextQuestion!.key);
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.length).toBe(1);
    expect(board[0].displayName).not.toContain("n1gger");
    expect(board[0].displayName.startsWith("Player ")).toBe(true);
  });

  test("abandoned runs never appear on leaderboards", async () => {
    const t = setup();
    await newPlayer(t);
    await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(api.trivia.abandonRun, { playerKey: PLAYER });
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.length).toBe(0);
  });
});


