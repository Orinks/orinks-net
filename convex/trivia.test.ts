/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
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

describe("player lifecycle", () => {
  test("ensurePlayer creates then updates", async () => {
    const t = setup();
    const first = await newPlayer(t);
    expect(first.created).toBe(true);
    expect(first.displayName).toBe("Tester");
    const second = await t.mutation(api.trivia.ensurePlayer, {
      playerKey: PLAYER,
      displayName: "  Renamed  ",
    });
    expect(second.created).toBe(false);
    expect(second.displayName).toBe("Renamed");
  });

  test("rejects short playerKey and empty display name", async () => {
    const t = setup();
    await expect(t.mutation(api.trivia.ensurePlayer, { playerKey: "short" })).rejects.toThrow();
    await expect(
      t.mutation(api.trivia.ensurePlayer, { playerKey: PLAYER, displayName: "   " }),
    ).rejects.toThrow();
  });
});

describe("run lifecycle", () => {
  test("startRun serves a sanitized question", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    expect(start.run.lives).toBe(3);
    expect(start.run.round).toBe(1);
    expect(start.question!.choices.length).toBeGreaterThanOrEqual(2);
    expect(start.question).not.toHaveProperty("answer");
    expect(start.question).not.toHaveProperty("explanation");
    expect(start.runNumber).toBe(1);
  });

  test("correct answers score with streak bonus; wrong answers cost lives", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    const q1 = questionByKey.get(start.question!.key)!;
    expect(first.correct).toBe(true);
    expect(first.scoreDelta).toBe(100 * q1.difficulty); // no streak bonus on first
    expect(first.run.streak).toBe(1);

    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, true);
    const q2 = questionByKey.get(first.nextQuestion!.key)!;
    expect(second.scoreDelta).toBe(100 * q2.difficulty + 25); // streak of 1 going in
    expect(second.run.streak).toBe(2);

    const third = await answer(t, PLAYER, start.run.runId, second.nextQuestion!.key, false);
    expect(third.correct).toBe(false);
    expect(third.correctIndex).toBe(questionByKey.get(second.nextQuestion!.key)!.answer);
    expect(third.run.lives).toBe(2);
    expect(third.run.streak).toBe(0);
    expect(third.scoreDelta).toBe(0);
  });

  test("reveals official provenance only after the answer resolves", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    const privateQuestion = questionByKey.get(start.question!.key)!;

    expect(start.question).not.toHaveProperty("source");
    const result = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    expect(result.disclosure).toEqual({
      source: {
        publisher: privateQuestion.source.publisher,
        title: privateQuestion.source.title,
        url: privateQuestion.source.url,
      },
      clipAttribution: null,
    });
    const serialized = JSON.stringify(result.disclosure);
    expect(serialized).not.toContain(privateQuestion.source.evidenceSummary);
    expect(serialized).not.toContain('"answer"');
  });

  test("three wrong answers end the run and finalize the profile", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    const result = await loseRun(t, PLAYER, start.run.runId, start.question!.key);
    expect(result.run.status).toBe("dead");
    expect(result.nextQuestion).toBeNull();
    expect(result.events.some((e: { type: string }) => e.type === "gameOver")).toBe(true);
    expect(
      result.events.some(
        (e: { type: string; key?: string }) => e.type === "achievement" && e.key === "first-run",
      ),
    ).toBe(true);

    const profile = await t.query(api.trivia.getProfile, { playerKey: PLAYER });
    expect(profile!.totalRuns).toBe(1);
    expect(profile!.totalAnswered).toBe(4); // 3 misses + the Dead Air redemption
    expect(profile!.totalCorrect).toBe(0);

    const active = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
    expect(active).toBeNull();
  });

  test("completing round 1 drops the first tape and advances the round", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    let questionKey = start.question!.key;
    let result;
    for (let i = 0; i < 5; i++) {
      result = await answer(t, PLAYER, start.run.runId, questionKey, true);
      if (result.nextQuestion) questionKey = result.nextQuestion.key;
    }
    const types = result!.events.map((e: { type: string }) => e.type);
    expect(types).toContain("roundComplete");
    // tape-01 has minRound 2; completing round 1 moves us to round 2.
    expect(types).toContain("tapeUnlocked");
    expect(result!.run.round).toBe(2);

    const story = await t.query(api.trivia.getStory, { playerKey: PLAYER });
    expect(story.tapes.length).toBe(1);
    expect(story.tapes[0].id).toBe("tape-01");
    expect(story.tapes[0].text.length).toBeGreaterThan(50);
    expect(story.finaleLines).toBeNull(); // no spoilers before the finale
  });

  test("questions never repeat within a run (across boost drafts)", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    const seen = new Set([start.question!.key]);
    let questionKey = start.question!.key;
    for (let i = 0; i < 15; i++) {
      const result = await answer(t, PLAYER, start.run.runId, questionKey, true);
      let next = result.nextQuestion;
      if (!next && result.run.status === "active" && result.run.drafting) {
        const drafted = await draftBoost(t, PLAYER, start.run.runId, result);
        next = drafted.question;
      }
      if (!next) break;
      expect(seen.has(next.key)).toBe(false);
      seen.add(next.key);
      questionKey = next.key;
    }
    expect(seen.size).toBeGreaterThan(10); // proves we crossed round boundaries
  });

  test("startRun abandons a previous active run", async () => {
    const t = setup();
    await newPlayer(t);
    await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    const second = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    const active = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
    expect(active!.run.runId).toBe(second.run.runId);
  });
});

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

describe("story gating", () => {
  test("completeFinale rejects players who haven't earned it", async () => {
    const t = setup();
    await newPlayer(t);
    await expect(t.mutation(api.trivia.completeFinale, { playerKey: PLAYER })).rejects.toThrow(
      /signal/,
    );
  });

  test("wipePlayer removes player, runs, and achievements", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await loseRun(t, PLAYER, start.run.runId, start.question!.key);
    const wiped = await t.mutation(internal.trivia.wipePlayer, { playerKey: PLAYER });
    expect(wiped.wiped).toBe(true);
    expect(await t.query(api.trivia.getProfile, { playerKey: PLAYER })).toBeNull();
  });
});

describe("themed rounds", () => {
  test("all questions within a round share the round's category", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    expect(start.run.roundCategory).not.toBeNull();
    const categories = new Set([start.question!.category]);
    let questionKey = start.question!.key;
    for (let i = 0; i < 5; i++) {
      const result = await answer(t, PLAYER, start.run.runId, questionKey, true);
      if (i < 4) {
        // Questions 2-5 belong to round 1 and must share its theme.
        categories.add(result.nextQuestion!.category);
        questionKey = result.nextQuestion!.key;
      } else {
        // The 5th answer completes the round; the next theme is unknown until
        // the boost draft resolves (announced at draft exit, when it's true).
        const roundEvent = result.events.find(
          (e: { type: string }) => e.type === "roundComplete",
        ) as { nextCategory: string | null } | undefined;
        expect(roundEvent).toBeDefined();
        expect(roundEvent!.nextCategory).toBeNull();
        expect(result.run.drafting).toBe(true);
        const drafted = await draftBoost(t, PLAYER, start.run.runId, result);
        expect(drafted.run.drafting).toBe(false);
        expect(drafted.run.roundCategory).not.toBeNull();
        expect(drafted.question!.category).toBe(drafted.run.roundCategory);
      }
    }
    expect(categories.size).toBe(1);
  });
});

describe("signal boosts", () => {
  /** Plays 5 correct answers to complete round 1 and reach the draft. */
  async function completeRound1(t: Caller, playerKey: string) {
    const start = await t.mutation(api.trivia.startRun, { playerKey });
    let key = start.question!.key;
    let result;
    for (let i = 0; i < 5; i++) {
      result = await answer(t, playerKey, start.run.runId, key, true);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    return { start, result: result! };
  }

  test("completing a round posts a 3-boost offer instead of a question", async () => {
    const t = setup();
    await newPlayer(t);
    const { result } = await completeRound1(t, PLAYER);
    expect(result.nextQuestion).toBeNull();
    expect(result.run.status).toBe("active");
    expect(result.run.drafting).toBe(true);
    const types = result.events.map((e: { type: string }) => e.type);
    expect(types).toContain("roundComplete");
    expect(types).toContain("boostOffer");
    const offer = result.boosts.offer!;
    expect(offer.length).toBe(3);
    expect(new Set(offer.map((b) => b.key)).size).toBe(3);
    for (const entry of offer) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.rules.length).toBeGreaterThan(0);
    }
  });

  test("chooseBoost applies the boost and opens the themed round", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await completeRound1(t, PLAYER);
    const pick = result.boosts.offer!.find((b) => b.kind !== "instant")!;
    const drafted = await draftBoost(t, PLAYER, start.run.runId, result, pick.key);
    expect(drafted.run.drafting).toBe(false);
    expect(drafted.run.roundCategory).not.toBeNull();
    expect(drafted.question).not.toBeNull();
    expect(drafted.question!.category).toBe(drafted.run.roundCategory);
    expect(drafted.boosts.owned.some((b) => b.key === pick.key)).toBe(true);
    expect(drafted.boosts.offer).toBeNull();
    expect(drafted.events.some((e: { type: string }) => e.type === "boostChosen")).toBe(true);
  });

  test("chooseBoost rejects a boost that isn't offered", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await completeRound1(t, PLAYER);
    const offered = new Set(result.boosts.offer!.map((b) => b.key));
    const notOffered = ["amplifier", "signal-lock", "night-owl-rates", "deep-cuts"].find(
      (key) => !offered.has(key),
    )!;
    await expect(
      t.mutation(api.trivia.chooseBoost, {
        playerKey: PLAYER,
        runId: start.run.runId as never,
        boostKey: notOffered,
      }),
    ).rejects.toThrow(/isn't in tonight's offer/);
  });

  test("daily boost offers are identical for every player", async () => {
    const t = setup();
    await newPlayer(t, "boost-daily-0001", "Early");
    await newPlayer(t, "boost-daily-0002", "Late");
    const runs = [] as Array<{ playerKey: string; offer: string[] }>;
    for (const playerKey of ["boost-daily-0001", "boost-daily-0002"]) {
      const start = await t.mutation(api.trivia.startRun, { playerKey, daily: true });
      let key = start.question!.key;
      let result;
      for (let i = 0; i < 5; i++) {
        result = await answer(t, playerKey, start.run.runId, key, true);
        if (result.nextQuestion) key = result.nextQuestion.key;
      }
      runs.push({ playerKey, offer: result!.boosts.offer!.map((b: { key: string }) => b.key) });
    }
    expect(runs[0].offer).toEqual(runs[1].offer);
  });

  test("a mid-draft run resumes with the same offer", async () => {
    const t = setup();
    await newPlayer(t);
    const { result } = await completeRound1(t, PLAYER);
    const offerKeys = result.boosts.offer!.map((b) => b.key);
    const active = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
    expect(active).not.toBeNull();
    expect(active!.question).toBeNull();
    expect(active!.run.drafting).toBe(true);
    expect(active!.boosts.offer!.map((b: { key: string }) => b.key)).toEqual(offerKeys);
  });

  test("second wind absorbs the first miss of a round only", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "second-wind" });
    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, false);
    expect(first.run.lives).toBe(3); // absorbed
    expect(
      first.events.some(
        (e: { type: string; key?: string }) => e.type === "boostTriggered" && e.key === "second-wind",
      ),
    ).toBe(true);
    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, false);
    expect(second.run.lives).toBe(2); // only the first miss is free
  });

  test("amplifier raises the streak bonus to 40", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "amplifier" });
    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    const q2 = questionByKey.get(first.nextQuestion!.key)!;
    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, true);
    expect(second.scoreDelta).toBe(100 * q2.difficulty + 40);
  });

  test("signal lock halves the streak instead of resetting it", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "signal-lock" });
    let key = start.question!.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(t, PLAYER, start.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    const wrong = await answer(t, PLAYER, start.run.runId, key, false);
    expect(wrong.run.streak).toBe(1); // floor(2 / 2), not 0
    expect(wrong.run.lives).toBe(2); // still costs the life
  });

  test("double broadcast doubles points and doubles life costs", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "double-broadcast" });
    const q1 = questionByKey.get(start.question!.key)!;
    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    expect(first.scoreDelta).toBe(100 * q1.difficulty * 2);
    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, false);
    expect(second.run.lives).toBe(1); // 3 - 2
  });

  test("static filter eliminates two wrong choices and rejects them as answers", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "static-filter" });
    const used = await t.mutation(api.trivia.useBoost, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      boostKey: "static-filter",
    });
    expect(used.eliminated.length).toBe(2);
    expect(used.chargesLeft).toBe(1);
    const question = questionByKey.get(start.question!.key)!;
    for (const index of used.eliminated) {
      expect(index).not.toBe(question.answer);
    }
    think();
    await expect(
      t.mutation(api.trivia.submitAnswer, {
        playerKey: PLAYER,
        runId: start.run.runId as never,
        choiceIndex: used.eliminated[0],
      }),
    ).rejects.toThrow(/eliminated/);
    const result = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    expect(result.correct).toBe(true);
  });
});

describe("daily mutators", () => {
  test("dailies share one seeded mutator; free runs have none", async () => {
    const t = setup();
    await newPlayer(t, "mut-player-00001", "One");
    await newPlayer(t, "mut-player-00002", "Two");
    const a = await t.mutation(api.trivia.startRun, { playerKey: "mut-player-00001", daily: true });
    const b = await t.mutation(api.trivia.startRun, { playerKey: "mut-player-00002", daily: true });
    expect(a.run.mutator).not.toBeNull();
    expect(a.run.mutator!.key).toBe(b.run.mutator!.key);
    expect(a.run.mutator!.rules.length).toBeGreaterThan(0);
    await newPlayer(t, "mut-player-00003", "Three");
    const free = await t.mutation(api.trivia.startRun, { playerKey: "mut-player-00003" });
    expect(free.run.mutator).toBeNull();
  });

  test("flat rates doubles base points and kills the streak bonus", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.setMutator, { playerKey: PLAYER, mutatorKey: "flat-rates" });
    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    const q2 = questionByKey.get(first.nextQuestion!.key)!;
    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, true);
    expect(second.scoreDelta).toBe(100 * q2.difficulty * 2); // doubled base, no streak bonus
  });

  test("long haul runs 7-question rounds", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.setMutator, { playerKey: PLAYER, mutatorKey: "long-haul" });
    let key = start.question!.key;
    let result;
    for (let i = 0; i < 6; i++) {
      result = await answer(t, PLAYER, start.run.runId, key, true);
      expect(result.run.questionsPerRound).toBe(7);
      // No round completion through answer 6...
      expect(result.events.some((e: { type: string }) => e.type === "roundComplete")).toBe(false);
      key = result.nextQuestion!.key;
    }
    // ...the 7th answer completes the round and opens the draft.
    result = await answer(t, PLAYER, start.run.runId, key, true);
    expect(result!.events.some((e: { type: string }) => e.type === "roundComplete")).toBe(true);
    expect(result!.run.drafting).toBe(true);
  });

  test("heavy rotation shifts the difficulty band up a tier", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.setMutator, { playerKey: PLAYER, mutatorKey: "heavy-rotation" });
    // (The shifted difficulty band steers pickQuestion but has on-theme
    // fallbacks, so only the deterministic scoring premium is asserted.)
    const first = await answer(t, PLAYER, start.run.runId, start.question!.key, true);
    const q2 = questionByKey.get(first.nextQuestion!.key)!;
    const second = await answer(t, PLAYER, start.run.runId, first.nextQuestion!.key, true);
    expect(second.scoreDelta).toBe(Math.round(100 * q2.difficulty * 1.5) + 25);
  });

  test("single signal locks every round to one theme", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.setMutator, { playerKey: PLAYER, mutatorKey: "single-signal" });
    // Play two full rounds; the theme picked at each draft exit must match.
    let key = start.question!.key;
    const roundThemes: string[] = [];
    let result;
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 5; i++) {
        result = await answer(t, PLAYER, start.run.runId, key, true);
        if (result.nextQuestion) key = result.nextQuestion.key;
      }
      expect(result!.run.drafting).toBe(true);
      const drafted = await draftBoost(t, PLAYER, start.run.runId, result!);
      roundThemes.push(drafted.run.roundCategory as string);
      key = drafted.question!.key;
    }
    expect(roundThemes[0]).toBe(roundThemes[1]);
  });

  test("thin ice restores a life every 2nd completed round", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.mutation(internal.trivia.setMutator, { playerKey: PLAYER, mutatorKey: "thin-ice" });
    let key = start.question!.key;
    let result;
    // Round 1: one wrong (drop to 2 lives), then finish the round.
    result = await answer(t, PLAYER, start.run.runId, key, false);
    key = result.nextQuestion!.key;
    for (let i = 0; i < 4; i++) {
      result = await answer(t, PLAYER, start.run.runId, key, true);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    expect(result!.run.drafting).toBe(true);
    expect(result!.events.some((e: { type: string }) => e.type === "lifeGained")).toBe(false); // round 1: no cadence hit
    // Take a non-instant boost — Spare Fuse would restore the life early and
    // mask the cadence assertion below.
    const safePick = result!.boosts.offer!.find((b: { kind: string }) => b.kind !== "instant")!.key;
    const drafted = await draftBoost(t, PLAYER, start.run.runId, result!, safePick);
    key = drafted.question!.key;
    // Round 2 completes → cadence 2 grants the life back.
    for (let i = 0; i < 5; i++) {
      result = await answer(t, PLAYER, start.run.runId, key, true);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    expect(result!.events.some((e: { type: string }) => e.type === "lifeGained")).toBe(true);
  });
});

describe("signal strength", () => {
  test("every 3rd consecutive correct answer stores a signal, capped at 3", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    let key = start.question!.key;
    for (let i = 1; i <= 12; i++) {
      const result = await answer(t, PLAYER, start.run.runId, key, true);
      const gained = result.events.find((e: { type: string }) => e.type === "signalGained");
      if (i === 3) {
        expect(result.run.signalStrength).toBe(1);
        expect(gained).toBeDefined();
      }
      if (i === 9) expect(result.run.signalStrength).toBe(3);
      if (i === 12) {
        expect(result.run.signalStrength).toBe(3); // capped
        expect(gained).toBeUndefined();
      }
      if (result.nextQuestion) {
        key = result.nextQuestion.key;
      } else if (result.run.drafting) {
        const safePick = result.boosts.offer!.find((b: { kind: string }) => b.kind !== "instant")!.key;
        const drafted = await draftBoost(t, PLAYER, start.run.runId, result, safePick);
        key = drafted.question!.key;
      }
    }
  });

  test("the producer's whisper eliminates one wrong choice for one signal", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    let key = start.question!.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, PLAYER, start.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    const whispered = await t.mutation(api.trivia.useSignal, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
    });
    expect(whispered.signalLeft).toBe(0);
    const question = questionByKey.get(key)!;
    expect(whispered.eliminated).not.toBe(question.answer);
    // The eliminated choice can't be answered...
    think();
    await expect(
      t.mutation(api.trivia.submitAnswer, {
        playerKey: PLAYER,
        runId: start.run.runId as never,
        choiceIndex: whispered.eliminated,
      }),
    ).rejects.toThrow(/eliminated/);
    // ...and a second whisper has no signal to spend.
    await expect(
      t.mutation(api.trivia.useSignal, { playerKey: PLAYER, runId: start.run.runId as never }),
    ).rejects.toThrow(/No signal strength/);
  });

  test("whisper and static filter are mutually exclusive per question", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    let key = start.question!.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, PLAYER, start.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    await t.mutation(internal.trivia.grantBoost, { playerKey: PLAYER, boostKey: "static-filter" });
    await t.mutation(api.trivia.useBoost, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      boostKey: "static-filter",
    });
    await expect(
      t.mutation(api.trivia.useSignal, { playerKey: PLAYER, runId: start.run.runId as never }),
    ).rejects.toThrow(/already applied/);
  });
});

describe("boss calls", () => {
  /** Plays three full rounds correctly (drafting between) up to the caller. */
  async function playToBossCall(t: Caller, playerKey: string) {
    const start = await t.mutation(api.trivia.startRun, { playerKey });
    let key = start.question!.key;
    let result;
    for (let round = 1; round <= 3; round++) {
      for (let i = 0; i < 5; i++) {
        result = await answer(t, playerKey, start.run.runId, key, true);
        if (result.nextQuestion) key = result.nextQuestion.key;
      }
      if (round < 3) {
        const safePick = result!.boosts.offer!.find((b: { kind: string }) => b.kind !== "instant")!.key;
        const drafted = await draftBoost(t, playerKey, start.run.runId, result!, safePick);
        key = drafted.question!.key;
      }
    }
    return { start, result: result! };
  }

  test("completing round 3 rings a caller instead of the draft", async () => {
    const t = setup();
    await newPlayer(t);
    const { result } = await playToBossCall(t, PLAYER);
    expect(result.nextQuestion).toBeNull();
    expect(result.run.drafting).toBe(false);
    expect(result.run.bossCall).not.toBeNull();
    expect(result.run.bossCall!.phase).toBe("question");
    expect(result.run.bossCall!.question).not.toBeNull();
    expect(["The Archivist", "The Night Owl"]).toContain(result.run.bossCall!.callerName);
    const types = result.events.map((e: { type: string }) => e.type);
    expect(types).toContain("bossCall");
    expect(types).not.toContain("boostOffer");
  });

  test("a correct caller answer opens the reward, then the draft follows", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await playToBossCall(t, PLAYER);
    const bossQuestion = questionByKey.get(result.run.bossCall!.question!.key)!;
    think();
    const res = await t.mutation(api.trivia.answerBossCall, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      choiceIndex: bossQuestion.answer,
    });
    expect(res.correct).toBe(true);
    expect(res.run.bossCall!.phase).toBe("reward");
    expect(res.run.drafting).toBe(false);

    const reward = await t.mutation(api.trivia.chooseBossReward, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      reward: "points",
    });
    expect(reward.run.score).toBe(res.run.score + 300);
    expect(reward.run.bossCall).toBeNull();
    expect(reward.run.drafting).toBe(true); // the commercial break still happens
  });

  test("a wrong caller answer costs nothing and the draft follows", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await playToBossCall(t, PLAYER);
    const bossQuestion = questionByKey.get(result.run.bossCall!.question!.key)!;
    const livesBefore = result.run.lives;
    think();
    const res = await t.mutation(api.trivia.answerBossCall, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      choiceIndex: (bossQuestion.answer + 1) % bossQuestion.choices.length,
    });
    expect(res.correct).toBe(false);
    expect(res.run.lives).toBe(livesBefore); // no lives at stake
    expect(res.run.bossCall).toBeNull();
    expect(res.run.drafting).toBe(true);
    expect(res.events.some((e: { type: string }) => e.type === "boostOffer")).toBe(true);
  });

  test("the filter reward adds a Static Filter charge", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await playToBossCall(t, PLAYER);
    const bossQuestion = questionByKey.get(result.run.bossCall!.question!.key)!;
    think();
    await t.mutation(api.trivia.answerBossCall, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      choiceIndex: bossQuestion.answer,
    });
    const reward = await t.mutation(api.trivia.chooseBossReward, {
      playerKey: PLAYER,
      runId: start.run.runId as never,
      reward: "filter",
    });
    const filter = reward.boosts.owned.find((b: { key: string }) => b.key === "static-filter");
    expect(filter).toBeDefined();
    expect(filter!.chargesLeft).toBeGreaterThanOrEqual(1);
  });

  test("a run resumes mid-call with the same caller and question", async () => {
    const t = setup();
    await newPlayer(t);
    const { result } = await playToBossCall(t, PLAYER);
    const active = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
    expect(active).not.toBeNull();
    expect(active!.question).toBeNull();
    expect(active!.run.bossCall!.phase).toBe("question");
    expect(active!.run.bossCall!.question!.key).toBe(result.run.bossCall!.question!.key);
    expect(active!.run.bossCall!.callerName).toBe(result.run.bossCall!.callerName);
  });
});

describe("dead air", () => {
  /** Burns all three lives; returns the response that entered Dead Air. */
  async function reachDeadAir(t: Caller, playerKey: string) {
    const start = await t.mutation(api.trivia.startRun, { playerKey });
    let key = start.question!.key;
    let result;
    for (let i = 0; i < 3; i++) {
      result = await answer(t, playerKey, start.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    return { start, result: result! };
  }

  test("losing the last life serves a redemption question, not a game over", async () => {
    const t = setup();
    await newPlayer(t);
    const { result } = await reachDeadAir(t, PLAYER);
    expect(result.run.status).toBe("active");
    expect(result.run.deadAir).toBe(true);
    expect(result.run.lives).toBe(0);
    expect(result.nextQuestion).not.toBeNull();
    const types = result.events.map((e: { type: string }) => e.type);
    expect(types).toContain("deadAir");
    expect(types).not.toContain("gameOver"); // mutually exclusive (a11y consult)
  });

  test("a correct redemption answer revives the run with one life", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await reachDeadAir(t, PLAYER);
    const survived = await answer(t, PLAYER, start.run.runId, result.nextQuestion!.key, true);
    expect(survived.run.status).toBe("active");
    expect(survived.run.lives).toBe(1);
    expect(survived.run.deadAir).toBe(false);
    expect(survived.events.some((e: { type: string }) => e.type === "deadAirSurvived")).toBe(true);
    expect(survived.nextQuestion).not.toBeNull();
  });

  test("a wrong redemption answer ends the run for real", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await reachDeadAir(t, PLAYER);
    const done = await answer(t, PLAYER, start.run.runId, result.nextQuestion!.key, false);
    expect(done.run.status).toBe("dead");
    expect(done.events.some((e: { type: string }) => e.type === "gameOver")).toBe(true);
  });

  test("dead air fires only once per run", async () => {
    const t = setup();
    await newPlayer(t);
    const { start, result } = await reachDeadAir(t, PLAYER);
    const survived = await answer(t, PLAYER, start.run.runId, result.nextQuestion!.key, true);
    // Back at 1 life: the next miss ends the run immediately.
    const done = await answer(t, PLAYER, start.run.runId, survived.nextQuestion!.key, false);
    expect(done.run.status).toBe("dead");
    expect(done.events.some((e: { type: string }) => e.type === "deadAir")).toBe(false);
  });
});

describe("account identity", () => {
  const IDENTITY = { subject: "user_clerk_abc", nickname: "SignalHunter", name: "Ada Vale" };

  test("signing in creates an account whose leaderboard name is the Clerk handle", async () => {
    const t = setup();
    const asUser = t.withIdentity(IDENTITY);
    const res = await asUser.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0001" });
    expect(res.signedIn).toBe(true);
    expect(res.displayName).toBe("SignalHunter");
    const profile = await asUser.query(api.trivia.getProfile, { playerKey: "device-key-0001" });
    expect(profile!.displayName).toBe("SignalHunter");
  });

  test("first sign-in claims the guest row's progress on this device", async () => {
    const t = setup();
    // Play a losing run as a guest first (builds totalAnswered).
    await t.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0002", displayName: "Guest" });
    const start = await t.mutation(api.trivia.startRun, { playerKey: "device-key-0002" });
    await loseRun(t, "device-key-0002", start.run.runId, start.question!.key);
    const guestProfile = await t.query(api.trivia.getProfile, { playerKey: "device-key-0002" });
    expect(guestProfile!.totalRuns).toBe(1);

    // Sign in on the same device: the account inherits that progress.
    const asUser = t.withIdentity(IDENTITY);
    const link = await asUser.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0002" });
    expect(link.migrated).toBe(true);
    const acctProfile = await asUser.query(api.trivia.getProfile, { playerKey: "device-key-0002" });
    expect(acctProfile!.totalRuns).toBe(1);
    expect(acctProfile!.displayName).toBe("SignalHunter");
  });

  test("a returning account is not re-created and keeps its stats", async () => {
    const t = setup();
    const asUser = t.withIdentity(IDENTITY);
    await asUser.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0003" });
    const again = await asUser.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0003" });
    expect(again.created).toBe(false);
    expect(again.signedIn).toBe(true);
  });

  test("signed-in runs appear on the leaderboard under the account handle", async () => {
    const t = setup();
    const asUser = t.withIdentity(IDENTITY);
    await asUser.mutation(api.trivia.ensurePlayer, { playerKey: "device-key-0004" });
    const start = await asUser.mutation(api.trivia.startRun, { playerKey: "device-key-0004" });
    const scored = await answer(asUser, "device-key-0004", start.run.runId, start.question!.key, true);
    await loseRun(asUser, "device-key-0004", start.run.runId, scored.nextQuestion!.key);
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.some((row) => row.displayName === "SignalHunter")).toBe(true);
  });
});

describe("anti-cheat", () => {
  test("a run answered superhumanly fast is flagged out of the leaderboard", async () => {
    const t = setup();
    const bot = t.withIdentity({ subject: "user_bot", nickname: "SpeedBot" });
    await bot.mutation(api.trivia.ensurePlayer, { playerKey: "bot-key-00000001" });
    const start = await bot.mutation(api.trivia.startRun, { playerKey: "bot-key-00000001" });
    let key = start.question!.key;
    let result;
    for (let i = 0; i < 5; i++) {
      // ~100ms per answer: impossible to read a question + four choices that fast.
      result = await answer(bot, "bot-key-00000001", start.run.runId, key, false, 100);
      if (result.run.status === "dead") break; // 3 misses + the Dead Air redemption
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    expect(result!.run.status).toBe("dead");
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.some((row) => row.displayName === "SpeedBot")).toBe(false);
  });

  test("a flagged run never sets the profile's best score or a personal best", async () => {
    const t = setup();
    const bot = t.withIdentity({ subject: "user_bot2", nickname: "ScoreBot" });
    await bot.mutation(api.trivia.ensurePlayer, { playerKey: "bot-key-00000002" });
    const start = await bot.mutation(api.trivia.startRun, { playerKey: "bot-key-00000002" });

    // Score points at bot speed, then die fast — 5 fast answers flag the run
    // and the third wrong lands before the round (and its draft) completes.
    let key = start.question!.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(bot, "bot-key-00000002", start.run.runId, key, true, 100);
      key = result.nextQuestion!.key;
    }
    let last;
    for (let i = 0; i < 5; i++) {
      last = await answer(bot, "bot-key-00000002", start.run.runId, key, false, 100);
      if (last.run.status === "dead") break; // through the Dead Air redemption
      if (last.nextQuestion) key = last.nextQuestion.key;
    }
    expect(last!.run.status).toBe("dead");
    expect(last!.run.score).toBeGreaterThan(0);
    const gameOver = last!.events.find((e: { type: string }) => e.type === "gameOver") as {
      isPersonalBest: boolean;
    };
    expect(gameOver.isPersonalBest).toBe(false);

    const profile = await bot.query(api.trivia.getProfile, { playerKey: "bot-key-00000002" });
    expect(profile!.totalRuns).toBe(1); // it still counts as played
    expect(profile!.bestScore).toBe(0); // but never as a record
    expect(profile!.deepestRound).toBe(0);
  });

  test("a human-paced run is not flagged and ranks normally", async () => {
    const t = setup();
    const human = t.withIdentity({ subject: "user_human", nickname: "RealPlayer" });
    await human.mutation(api.trivia.ensurePlayer, { playerKey: "human-key-0000001" });
    const start = await human.mutation(api.trivia.startRun, { playerKey: "human-key-0000001" });
    const scored = await answer(human, "human-key-0000001", start.run.runId, start.question!.key, true); // default human pace
    await loseRun(human, "human-key-0000001", start.run.runId, scored.nextQuestion!.key);
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.some((row) => row.displayName === "RealPlayer")).toBe(true);
  });

  test("startRun is rate-limited per player", async () => {
    const t = setup();
    const grinder = t.withIdentity({ subject: "user_rl", nickname: "Grinder" });
    await grinder.mutation(api.trivia.ensurePlayer, { playerKey: "rl-key-000000001" });
    let threw = false;
    for (let i = 0; i < 45; i++) {
      try {
        await grinder.mutation(api.trivia.startRun, { playerKey: "rl-key-000000001" });
      } catch {
        threw = true;
        break;
      }
    }
    expect(threw).toBe(true);
  });
});
