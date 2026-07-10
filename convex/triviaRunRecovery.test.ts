/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { questionByKey, type BankQuestion } from "./questionBank";
import { RUN_LIBRARY_RESET_REASON } from "./triviaRunRecovery";

const modules = import.meta.glob("./**/*.ts");
const PLAYER = "recovery-player-0001";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: 1_700_000_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  return convexTest(schema, modules);
}

async function newPlayer(t: ReturnType<typeof convexTest>, key = PLAYER) {
  await t.mutation(api.trivia.ensurePlayer, { playerKey: key, displayName: "Recovery Tester" });
}

describe("retired question-library recovery", () => {
  test("retires a stale regular run and returns an announcer-ready reset reason", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.run(async (ctx) => {
      await ctx.db.patch(first.run.runId, { currentQuestionKey: "otdb-retired-question" });
    });

    await expect(
      t.mutation(api.trivia.submitAnswer, {
        playerKey: PLAYER,
        runId: first.run.runId,
        choiceIndex: 0,
      }),
    ).rejects.toThrow(RUN_LIBRARY_RESET_REASON);
    expect(await t.query(api.trivia.getActiveRun, { playerKey: PLAYER })).toBeNull();

    const replacement = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    expect(replacement.run.runId).not.toBe(first.run.runId);
    expect(replacement.resetReason).toBe(RUN_LIBRARY_RESET_REASON);
    expect(replacement.question?.key).not.toMatch(/^(?:gt-|mb-|otdb-)/u);
    const retired = await t.run((ctx) => ctx.db.get(first.run.runId));
    expect(retired?.status).toBe("abandoned");
  });

  test("replaces a stale legacy daily without consuming tonight's official episode", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(first.run.runId, {
        dailyEpisodeId: undefined,
        contentVersion: undefined,
        rulesVersion: undefined,
        currentQuestionKey: "mb-retired-question",
      });
    });

    const replacement = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    expect(replacement.resumed).toBe(false);
    expect(replacement.resetReason).toBe(RUN_LIBRARY_RESET_REASON);
    expect(replacement.run.runId).not.toBe(first.run.runId);
    expect(replacement.question).not.toBeNull();
  });

  test("retires a missing Boss Call question instead of resuming an empty call", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    await t.run(async (ctx) => {
      await ctx.db.patch(first.run.runId, {
        currentQuestionKey: undefined,
        bossCall: {
          caller: "archivist",
          questionKey: "gt-retired-boss",
          servedAt: Date.now(),
          phase: "question",
        },
      });
    });

    expect(await t.query(api.trivia.getActiveRun, { playerKey: PLAYER })).toBeNull();
    const replacement = await t.mutation(api.trivia.startRun, { playerKey: PLAYER });
    expect(replacement.resetReason).toBe(RUN_LIBRARY_RESET_REASON);
    expect(replacement.run.runId).not.toBe(first.run.runId);
  });

  test("keeps a valid legacy daily draft resumable", async () => {
    const t = setup();
    await newPlayer(t);
    const first = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(first.run.runId, {
        dailyEpisodeId: undefined,
        contentVersion: undefined,
        rulesVersion: undefined,
        currentQuestionKey: undefined,
        pendingBoostOffer: ["spare-fuse", "deep-cuts", "static-filter"],
      });
    });

    const resumed = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    expect(resumed.resumed).toBe(true);
    expect(resumed.resetReason).toBeNull();
    expect(resumed.run.runId).toBe(first.run.runId);
    expect(resumed.run.drafting).toBe(true);
  });

  test("scores a nightly answer from the frozen snapshot after the live bank changes", async () => {
    const t = setup();
    await newPlayer(t);
    const start = await t.mutation(api.trivia.startRun, { playerKey: PLAYER, daily: true });
    const live = questionByKey.get(start.question!.key)!;
    const original = {
      prompt: live.prompt,
      choices: [...live.choices] as BankQuestion["choices"],
      answer: live.answer,
    };
    const frozen = await t.run(async (ctx) => {
      const episode = (await ctx.db.query("dailyEpisodes").collect())[0];
      return episode.candidates.find((candidate) => candidate.questionId === start.question!.key)!
        .snapshot!;
    });

    try {
      live.prompt = "A later deployment changed this prompt.";
      live.choices = ["Changed A", "Changed B", "Changed C", "Changed D"];
      live.answer = ((frozen.answer + 1) % 4) as typeof live.answer;
      questionByKey.delete(live.id);
      const resumed = await t.query(api.trivia.getActiveRun, { playerKey: PLAYER });
      expect(resumed?.question?.prompt).toBe(frozen.prompt);
      expect(resumed?.question?.choices).toEqual(frozen.choices);
      const result = await t.mutation(api.trivia.submitAnswer, {
        playerKey: PLAYER,
        runId: start.run.runId,
        choiceIndex: frozen.answer,
      });
      expect(result.correct).toBe(true);
      expect(result.correctIndex).toBe(frozen.answer);
    } finally {
      live.prompt = original.prompt;
      live.choices = original.choices;
      live.answer = original.answer;
      questionByKey.set(live.id, live);
    }
  });
});
