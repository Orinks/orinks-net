/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { questionByKey } from "./questionBank";

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
  test("finished account runs rank by score across scopes", async () => {
    const t = setup();
    const alpha = t.withIdentity({ subject: "user_alpha", nickname: "Alpha" });
    const beta = t.withIdentity({ subject: "user_beta", nickname: "Beta" });
    await alpha.mutation(api.trivia.ensurePlayer, { playerKey: "leader-player-0001" });
    await beta.mutation(api.trivia.ensurePlayer, { playerKey: "leader-player-0002" });

    // Alpha scores then dies; Beta dies immediately.
    const runA = await alpha.mutation(api.trivia.startRun, { playerKey: "leader-player-0001" });
    let key = runA.question.key;
    for (let i = 0; i < 2; i++) {
      const result = await answer(alpha, "leader-player-0001", runA.run.runId, key, true);
      key = result.nextQuestion!.key;
    }
    for (let i = 0; i < 3; i++) {
      const result = await answer(alpha, "leader-player-0001", runA.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    const runB = await beta.mutation(api.trivia.startRun, { playerKey: "leader-player-0002" });
    key = runB.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(beta, "leader-player-0002", runB.run.runId, key, false);
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

  test("guests do not appear on the public leaderboard", async () => {
    const t = setup();
    await newPlayer(t, "guest-leader-0001", "SomeGuest");
    const start = await t.mutation(api.trivia.startRun, { playerKey: "guest-leader-0001" });
    let key = start.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(t, "guest-leader-0001", start.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.length).toBe(0);
  });

  test("offensive account handles are masked on the leaderboard", async () => {
    const t = setup();
    const troll = t.withIdentity({ subject: "user_troll", nickname: "n1gger" });
    await troll.mutation(api.trivia.ensurePlayer, { playerKey: "troll-key-000001" });
    const run = await troll.mutation(api.trivia.startRun, { playerKey: "troll-key-000001" });
    let key = run.question.key;
    for (let i = 0; i < 3; i++) {
      const result = await answer(troll, "troll-key-000001", run.run.runId, key, false);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
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

describe("themed rounds", () => {
  test("all questions within a round share the round's category", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    expect(start.run.roundCategory).not.toBeNull();
    const categories = new Set([start.question.category]);
    let questionKey = start.question.key;
    for (let i = 0; i < 5; i++) {
      const result = await answer(t, PLAYER, start.run.runId, questionKey, true);
      if (i < 4) {
        // Questions 2-5 belong to round 1 and must share its theme.
        categories.add(result.nextQuestion!.category);
        questionKey = result.nextQuestion!.key;
      } else {
        // The 5th answer completes the round; a new theme is announced.
        const roundEvent = result.events.find(
          (e: { type: string }) => e.type === "roundComplete",
        ) as { nextCategory: string | null } | undefined;
        expect(roundEvent).toBeDefined();
        expect(result.run.roundCategory).toBe(roundEvent!.nextCategory);
      }
    }
    expect(categories.size).toBe(1);
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
    let key = start.question.key;
    for (let i = 0; i < 3; i++) {
      const r = await answer(t, "device-key-0002", start.run.runId, key, false);
      if (r.nextQuestion) key = r.nextQuestion.key;
    }
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
    let key = start.question.key;
    for (let i = 0; i < 3; i++) {
      const r = await answer(asUser, "device-key-0004", start.run.runId, key, false);
      if (r.nextQuestion) key = r.nextQuestion.key;
    }
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
    let key = start.question.key;
    let result;
    for (let i = 0; i < 3; i++) {
      // ~100ms per answer: impossible to read a question + four choices that fast.
      result = await answer(bot, "bot-key-00000001", start.run.runId, key, false, 100);
      if (result.nextQuestion) key = result.nextQuestion.key;
    }
    expect(result!.run.status).toBe("dead");
    const board = await t.query(api.trivia.getLeaderboard, { scope: "alltime" });
    expect(board.some((row) => row.displayName === "SpeedBot")).toBe(false);
  });

  test("a human-paced run is not flagged and ranks normally", async () => {
    const t = setup();
    const human = t.withIdentity({ subject: "user_human", nickname: "RealPlayer" });
    await human.mutation(api.trivia.ensurePlayer, { playerKey: "human-key-0000001" });
    const start = await human.mutation(api.trivia.startRun, { playerKey: "human-key-0000001" });
    let key = start.question.key;
    for (let i = 0; i < 3; i++) {
      const r = await answer(human, "human-key-0000001", start.run.runId, key, false); // default human pace
      if (r.nextQuestion) key = r.nextQuestion.key;
    }
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
