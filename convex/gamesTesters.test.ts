/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
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

/** Connects `game` for a new account called `name`; the token's hash. */
async function connect(t: ReturnType<typeof setup>, game: string, subject: string, name: string) {
  const now = Date.now();
  const started = await t.mutation(api.games.startActivation, { secret: SECRET, game, now });
  await t.withIdentity({ subject }).mutation(api.games.claimActivation, { userCode: started.userCode, displayName: name });
  const deviceCodeHash = await sha256Hex(started.deviceCode);
  const polled = await t.mutation(api.games.pollActivation, { secret: SECRET, game, deviceCodeHash, now: now + 2000 });
  if (polled.status !== "ready") throw new Error("not ready");
  return sha256Hex(polled.token);
}

describe("testers", () => {
  test("a flagged player is a tester of that game only", async () => {
    const t = setup();
    const wickets = await connect(t, "wickets", "user_ada", "Ada");
    const player = (game: string, tokenHash: string) =>
      t.query(api.games.playerForToken, { secret: SECRET, game, tokenHash });
    expect((await player("wickets", wickets))?.tester).toBeUndefined();

    // Any case, as the name is typed into the workflow.
    const set = await t.mutation(internal.games.setTester, { name: " ada ", game: "wickets" });
    expect(set).toEqual({ name: "Ada", game: "wickets", tester: true });
    expect((await player("wickets", wickets))?.tester).toBe(true);
    expect(await t.query(internal.games.listTesters, { game: "wickets" })).toEqual(["Ada"]);

    const dash = await connect(t, "dash", "user_ada", "Ada");
    expect((await player("dash", dash))?.tester).toBeUndefined();

    await t.mutation(internal.games.setTester, { name: "Ada", game: "wickets", tester: false });
    expect((await player("wickets", wickets))?.tester).toBeUndefined();
    expect(await t.query(internal.games.listTesters, { game: "wickets" })).toEqual([]);
  });

  test("flagging twice keeps one entry, and an unknown name is refused", async () => {
    const t = setup();
    await connect(t, "wickets", "user_bo", "Bo Peep");
    await t.mutation(internal.games.setTester, { name: "Bo Peep", game: "wickets" });
    await t.mutation(internal.games.setTester, { name: "Bo Peep", game: "wickets" });
    expect(await t.query(internal.games.listTesters, { game: "wickets" })).toEqual(["Bo Peep"]);
    await expect(t.mutation(internal.games.setTester, { name: "Nobody", game: "wickets" })).rejects.toThrow(/Nobody/);
  });
});

describe("the testers page", () => {
  test("only the owner's verified email may list and change testers", async () => {
    const t = setup();
    await connect(t, "wickets", "user_cy", "Cy Young");
    const owner = t.withIdentity({ subject: "user_owner", email: "Orin8722@gmail.com", emailVerified: true });
    const stranger = t.withIdentity({ subject: "user_x", email: "someone@example.com", emailVerified: true });
    const unverified = t.withIdentity({ subject: "user_y", email: "orin8722@gmail.com", emailVerified: false });

    expect(await stranger.query(api.games.adminListTesters, { game: "wickets" })).toBeNull();
    expect(await unverified.query(api.games.adminListTesters, { game: "wickets" })).toBeNull();
    expect(await t.query(api.games.adminListTesters, { game: "wickets" })).toBeNull();
    expect(await stranger.mutation(api.games.adminSetTester, { name: "Cy Young", game: "wickets", tester: true })).toEqual({
      ok: false,
      code: "forbidden",
    });

    expect(await owner.query(api.games.adminListTesters, { game: "wickets" })).toEqual([]);
    expect(await owner.mutation(api.games.adminSetTester, { name: "cy young", game: "wickets", tester: true })).toEqual({
      ok: true,
      name: "Cy Young",
      game: "wickets",
      tester: true,
    });
    expect(await owner.query(api.games.adminListTesters, { game: "wickets" })).toEqual(["Cy Young"]);
    expect(await owner.mutation(api.games.adminSetTester, { name: "Nobody", game: "wickets", tester: true })).toEqual({
      ok: false,
      code: "no_player",
    });
    await owner.mutation(api.games.adminSetTester, { name: "Cy Young", game: "wickets", tester: false });
    expect(await owner.query(api.games.adminListTesters, { game: "wickets" })).toEqual([]);
  });
});
