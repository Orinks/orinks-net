/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { questionByKey } from "./questionBank";

const modules = import.meta.glob("./**/*.ts");

const PLAYER = "test-player-0001";

function setup() {
  return convexTest(schema, modules);
}

async function newPlayer(t: ReturnType<typeof convexTest>, key = PLAYER, name = "Tester") {
  return t.mutation(api.trivia.ensurePlayer, { playerKey: key, displayName: name });
}

/** Answer the current question; pass correctly=true/false to steer the run. */
async function answer(
  t: ReturnType<typeof convexTest>,
  playerKey: string,
  runId: string,
  questionKey: string,
  correctly: boolean,
) {
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
    expect(start.question.choices.length).toBeGreaterThanOrEqual(2);
    expect(start.question).not.toHaveProperty("answer");
    expect(start.question).not.toHaveProperty("explanation");
    expect(start.runNumber).toBe(1);
  });

  test("correct answers score with streak bonus; wrong answers cost lives", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    const first = await answer(t, PLAYER, start.run.runId, start.question.key, true);
    const q1 = questionByKey.get(start.question.key)!;
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

  test("three wrong answers end the run and finalize the profile", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    let questionKey = start.question.key;
    let result;
    for (let i = 0; i < 3; i++) {
      result = await answer(t, PLAYER, start.run.runId, questionKey, false);
      if (result.nextQuestion) questionKey = result.nextQuestion.key;
    }
    expect(result!.run.status).toBe("dead");
    expect(result!.nextQuestion).toBeNull();
    expect(result!.events.some((e: { type: string }) => e.type === "gameOver")).toBe(true);
    expect(
      result!.events.some(
        (e: { type: string; key?: string }) => e.type === "achievement" && e.key === "first-run",
      ),
    ).toBe(true);

    const profile = await t.query(api.trivia.getProfile, { playerKey: PLAYER });
    expect(profile!.totalRuns).toBe(1);
    expect(profile!.totalAnswered).toBe(3);
    expect(profile!.totalCorrect).toBe(0);

    const active = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
    expect(active).toBeNull();
  });

  test("completing round 1 drops the first tape and advances the round", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });

    let questionKey = start.question.key;
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

  test("questions never repeat within a run", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    const seen = new Set([start.question.key]);
    let questionKey = start.question.key;
    for (let i = 0; i < 15; i++) {
      const result = await answer(t, PLAYER, start.run.runId, questionKey, true);
      if (!result.nextQuestion) break;
      expect(seen.has(result.nextQuestion.key)).toBe(false);
      seen.add(result.nextQuestion.key);
      questionKey = result.nextQuestion.key;
    }
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
  test("daily runs serve identical question sequences to different players", async () => {
    const t = setup();
    await newPlayer(t, "daily-player-0001", "Early Bird");
    await newPlayer(t, "daily-player-0002", "Night Owl");

    const runA = await t.mutation(api.trivia.startRun, { playerKey: "daily-player-0001", daily: true });
    const runB = await t.mutation(api.trivia.startRun, { playerKey: "daily-player-0002", daily: true });
    expect(runA.question.key).toBe(runB.question.key);

    // Sequences stay aligned even when one player answers wrong.
    const a2 = await answer(t, "daily-player-0001", runA.run.runId, runA.question.key, true);
    const b2 = await answer(t, "daily-player-0002", runB.run.runId, runB.question.key, false);
    expect(a2.nextQuestion!.key).toBe(b2.nextQuestion!.key);
  });

  test("a finished daily cannot be replayed the same day", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    let questionKey = start.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, PLAYER, start.run.runId, questionKey, false);
      if (result.nextQuestion) questionKey = result.nextQuestion.key;
    }
    await expect(
      t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true }),
    ).rejects.toThrow(/already aired/);
  });
});

describe("leaderboards", () => {
  test("finished runs rank by score across scopes", async () => {
    const t = setup();
    await newPlayer(t, "leader-player-0001", "Alpha");
    await newPlayer(t, "leader-player-0002", "Beta");

    // Alpha scores then dies; Beta dies immediately.
    const runA = await t.mutation(api.trivia.startRun, { playerKey: "leader-player-0001" });
    let key = runA.question.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(t, "leader-player-0001", runA.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, "leader-player-0001", runA.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    const runB = await t.mutation(api.trivia.startRun, { playerKey: "leader-player-0002" });
    key = runB.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, "leader-player-0002", runB.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }

    for (const scope of ["alltime", "daily", "weekly"] as const) {
      const board = await t.query(api.trivia.getLeaderboard, { scope });
      expect(board.length).toBe(2);
      expect(board[0].displayName).toBe("Alpha");
      expect(board[0].rank).toBe(1);
      expect(board[0].score).toBeGreaterThan(board[1].score);
    }
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
    let key = start.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, PLAYER, start.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    const wiped = await t.mutation(internal.trivia.wipePlayer, { playerKey: PLAYER });
    expect(wiped.wiped).toBe(true);
    expect(await t.query(api.trivia.getProfile, { playerKey: PLAYER })).toBeNull();
  });
});
