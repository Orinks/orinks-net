/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { sha256Hex } from "./games";

const SECRET = "test-games-secret-that-is-long-enough-0000";

function setup() {
  return convexTest(schema, import.meta.glob("./**/*.ts"));
}

beforeEach(() => {
  process.env.GAMES_SERVER_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.GAMES_SERVER_SECRET;
});

async function connect(t: ReturnType<typeof setup>, subject: string, name?: string) {
  const now = 1_000_000;
  const started = await t.mutation(api.games.startActivation, { secret: SECRET, game: "dash", now });
  const claimed = await t
    .withIdentity({ subject })
    .mutation(api.games.claimActivation, { userCode: started.userCode, displayName: name, now: now + 1000 });
  const deviceCodeHash = await sha256Hex(started.deviceCode);
  const polled = await t.mutation(api.games.pollActivation, { secret: SECRET, game: "dash", deviceCodeHash, now: now + 2000 });
  return { started, claimed, polled, deviceCodeHash };
}

describe("the server secret", () => {
  test("every server function refuses a caller without it", async () => {
    const t = setup();
    await expect(t.mutation(api.games.startActivation, { secret: "x".repeat(40), game: "dash", now: 1 })).rejects.toThrow();
    await expect(
      t.mutation(api.games.putRecord, {
        secret: "wrong",
        game: "dash",
        collection: "best",
        key: "p1",
        value: 1,
        now: 1,
      }),
    ).rejects.toThrow();
    delete process.env.GAMES_SERVER_SECRET;
    // Unset on the deployment: nothing is open, not even to an empty secret.
    await expect(t.mutation(api.games.startActivation, { secret: "", game: "dash", now: 1 })).rejects.toThrow();
  });
});

describe("connecting a game", () => {
  test("a first connect creates the player and hands the game a token once", async () => {
    const t = setup();
    const { claimed, polled, deviceCodeHash } = await connect(t, "user_ada", "Ada Lovelace");
    expect(claimed).toEqual({ ok: true, game: "dash" });
    expect(polled.status).toBe("ready");
    if (polled.status !== "ready") throw new Error("not ready");
    expect(polled.name).toBe("Ada Lovelace");
    const again = await t.mutation(api.games.pollActivation, { secret: SECRET, game: "dash", deviceCodeHash, now: 1_003_000 });
    expect(again.status).toBe("expired");

    const tokenHash = await sha256Hex(polled.token);
    const player = await t.mutation(api.games.playerForToken, { secret: SECRET, game: "dash", tokenHash, now: 1 });
    expect(player?.name).toBe("Ada Lovelace");
    // A token is for its own game only.
    expect(await t.mutation(api.games.playerForToken, { secret: SECRET, game: "other", tokenHash, now: 1 })).toBeNull();
    expect(await t.withIdentity({ subject: "user_ada" }).query(api.games.getMyGamesPlayer, {})).toEqual({
      displayName: "Ada Lovelace",
    });
  });

  test("a new account must name its player, and names are unique", async () => {
    const t = setup();
    const start = () => t.mutation(api.games.startActivation, { secret: SECRET, game: "dash", now: 1 });
    const first = await start();
    expect(
      await t.withIdentity({ subject: "user_bo" }).mutation(api.games.claimActivation, { userCode: first.userCode, now: 2 }),
    ).toEqual({ ok: false, code: "no_player" });
    await connect(t, "user_ada", "Ada");
    const second = await start();
    expect(
      await t
        .withIdentity({ subject: "user_bo" })
        .mutation(api.games.claimActivation, { userCode: second.userCode, displayName: "ada", now: 2 }),
    ).toEqual({ ok: false, code: "name_taken" });
  });

  test("an unknown or expired code is one answer", async () => {
    const t = setup();
    const started = await t.mutation(api.games.startActivation, { secret: SECRET, game: "dash", now: 1 });
    const ada = t.withIdentity({ subject: "user_ada" });
    expect(await ada.mutation(api.games.claimActivation, { userCode: "WKQR-3468", displayName: "Ada", now: 2 })).toEqual({
      ok: false,
      code: "unknown_code",
    });
    expect(
      await ada.mutation(api.games.claimActivation, { userCode: started.userCode, displayName: "Ada", now: 11 * 60_000 }),
    ).toEqual({ ok: false, code: "unknown_code" });
  });
});

describe("run claims", () => {
  const claim = (t: ReturnType<typeof setup>, playerId: string, now: number) =>
    t.mutation(api.games.claimRun, { secret: SECRET, game: "dash", key: "daily:abc", playerId, kind: "daily", staleMs: 120_000, now });

  test("one claim wins, a finished run answers from its reply, a dead one frees", async () => {
    const t = setup();
    const first = await claim(t, "p1", 1);
    expect(first.claimed).toBe(true);
    const second = await claim(t, "p2", 2);
    expect(second).toEqual({ claimed: false, existing: { player: "p1" } });
    // The claim's holder dies; after the stale window another may take it.
    const third = await claim(t, "p2", 200_000);
    expect(third.claimed).toBe(true);
    if (!third.claimed) throw new Error("not claimed");
    // The first holder's late reply is not its to write any more.
    if (!first.claimed) throw new Error("not claimed");
    await t.mutation(api.games.completeRun, { secret: SECRET, game: "dash", key: "daily:abc", nonce: first.nonce, reply: "late" });
    await t.mutation(api.games.completeRun, { secret: SECRET, game: "dash", key: "daily:abc", nonce: third.nonce, reply: { rank: 1 } });
    expect(await claim(t, "p3", 10_000_000)).toEqual({ claimed: false, existing: { player: "p2", reply: { rank: 1 } } });
  });

  test("a released claim is gone", async () => {
    const t = setup();
    const first = await claim(t, "p1", 1);
    if (!first.claimed) throw new Error("not claimed");
    await t.mutation(api.games.releaseRun, { secret: SECRET, game: "dash", key: "daily:abc", nonce: first.nonce });
    expect((await claim(t, "p2", 2)).claimed).toBe(true);
  });
});

describe("records", () => {
  test("a collection lists by order and counts who is ahead", async () => {
    const t = setup();
    const put = (key: string, order: number) =>
      t.mutation(api.games.putRecord, { secret: SECRET, game: "dash", collection: "daily:2026-10-27", key, playerId: key, order, value: { coins: order }, now: 1 });
    await put("p1", 5);
    await put("p2", 9);
    await put("p3", 7);
    await put("p1", 8);
    const top = await t.query(api.games.listRecords, { secret: SECRET, game: "dash", collection: "daily:2026-10-27", limit: 10 });
    expect(top.map((r) => r.key)).toEqual(["p2", "p1", "p3"]);
    expect(await t.query(api.games.countAbove, { secret: SECRET, game: "dash", collection: "daily:2026-10-27", order: 8 })).toBe(1);
    const other = await t.query(api.games.listRecords, { secret: SECRET, game: "other", collection: "daily:2026-10-27", limit: 10 });
    expect(other).toEqual([]);
    await expect(
      t.mutation(api.games.putRecord, { secret: SECRET, game: "dash", collection: "x", key: "k", value: "y".repeat(20_000), now: 1 }),
    ).rejects.toThrow();
  });
});

describe("account deletion", () => {
  test("removes the player, its tokens and its records", async () => {
    const t = setup();
    const { polled } = await connect(t, "user_ada", "Ada");
    if (polled.status !== "ready") throw new Error("not ready");
    await t.mutation(api.games.putRecord, { secret: SECRET, game: "dash", collection: "best", key: "x", playerId: "x", value: 1, now: 1 });
    const player = await t.mutation(api.games.playerForToken, {
      secret: SECRET,
      game: "dash",
      tokenHash: await sha256Hex(polled.token),
      now: 1,
    });
    await t.mutation(api.games.putRecord, { secret: SECRET, game: "dash", collection: "best", key: player!.id, playerId: player!.id, value: 1, now: 1 });
    await t.run(async (ctx) => {
      const { purgeGamesPlayer } = await import("./games");
      await purgeGamesPlayer(ctx, "user_ada");
    });
    expect(
      await t.mutation(api.games.playerForToken, { secret: SECRET, game: "dash", tokenHash: await sha256Hex(polled.token), now: 1 }),
    ).toBeNull();
    const left = await t.query(api.games.listRecords, { secret: SECRET, game: "dash", collection: "best", limit: 10 });
    expect(left.map((r) => r.key)).toEqual(["x"]);
  });
});
