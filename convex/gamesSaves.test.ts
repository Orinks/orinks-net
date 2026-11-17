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

const slot = { secret: SECRET, game: "wickets", playerId: "p_1", name: "records" };

function bytes(n: number) {
  return new Uint8Array([0x48, 0x4b, 0x53, 0x4c, n]).buffer;
}

describe("synced files", () => {
  test("revisions go up from their base, and a stale base is refused", async () => {
    const t = setup();
    expect(await t.query(api.gamesSaves.head, slot)).toBeNull();
    const hash = "a".repeat(64);
    expect(await t.mutation(api.gamesSaves.store, { ...slot, base: 0, format: 1, hash, content: bytes(1), now: 5 })).toEqual({
      revision: 1,
    });
    expect(await t.mutation(api.gamesSaves.store, { ...slot, base: 1, format: 1, hash, content: bytes(2), now: 6 })).toEqual({
      revision: 2,
    });
    expect(await t.mutation(api.gamesSaves.store, { ...slot, base: 1, format: 1, hash, content: bytes(3), now: 7 })).toEqual({
      stale: true,
      revision: 2,
    });
    const head = await t.query(api.gamesSaves.head, slot);
    expect(head).toMatchObject({ revision: 2, bytes: 5, format: 1, at: 6 });
    const read = await t.query(api.gamesSaves.read, slot);
    expect(new Uint8Array(read!.content)[4]).toBe(2);
  });

  test("only the last ten revisions are kept", async () => {
    const t = setup();
    for (let i = 0; i < 12; i++) {
      await t.mutation(api.gamesSaves.store, { ...slot, base: i, format: 1, hash: "b".repeat(64), content: bytes(i), now: i });
    }
    const rows = await t.run((ctx) => ctx.db.query("gamesSaves").collect());
    expect(rows.map((r) => r.revision).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect((await t.run((ctx) => ctx.db.query("gamesSaveContent").collect())).length).toBe(10);
  });

  test("the server secret is required", async () => {
    const t = setup();
    await expect(t.query(api.gamesSaves.head, { ...slot, secret: "x".repeat(40) })).rejects.toThrow();
  });
});

describe("the player page", () => {
  test("a player can hide their page, and the page query says so", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("gamesPlayers", {
        playerId: "p_1",
        authSubject: "user_1",
        displayName: "Ada",
        nameKey: "ada",
        createdAt: 1,
      }),
    );
    expect(await t.query(api.games.playerForPage, { secret: SECRET, name: "ADA" })).toEqual({
      playerId: "p_1",
      name: "Ada",
      hidden: false,
    });
    const me = t.withIdentity({ subject: "user_1" });
    expect(await me.mutation(api.games.setProfileHidden, { hidden: true })).toEqual({ ok: true, hidden: true });
    expect((await t.query(api.games.playerForPage, { secret: SECRET, name: "ada" }))?.hidden).toBe(true);
    expect(await me.query(api.games.getMyGamesPlayer, {})).toEqual({ displayName: "Ada", profileHidden: true });
    expect(await t.mutation(api.games.setProfileHidden, { hidden: false })).toEqual({ ok: false });
    expect(await t.query(api.games.playerForPage, { secret: SECRET, name: "nobody" })).toBeNull();
  });

  test("deleting the account deletes its saves", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("gamesPlayers", { playerId: "p_1", authSubject: "user_1", displayName: "Ada", nameKey: "ada", createdAt: 1 }),
    );
    await t.mutation(api.gamesSaves.store, { ...slot, base: 0, format: 1, hash: await sha256Hex("x"), content: bytes(1), now: 1 });
    const { purgeGamesPlayer } = await import("./games");
    await t.run((ctx) => purgeGamesPlayer(ctx, "user_1"));
    expect(await t.run((ctx) => ctx.db.query("gamesSaves").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("gamesSaveContent").collect())).toEqual([]);
  });
});
