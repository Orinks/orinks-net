/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { DRAFT_TTL_MS } from "./problemReports";

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

/** Stages a draft the way the site's server does: one upload per log, then the row. */
async function stage(t: ReturnType<typeof setup>, now: number, logs: Record<string, string> = { "game.log": "12:00 started\n" }) {
  const named = [];
  for (const [name, text] of Object.entries(logs)) {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text], { type: "text/plain" })));
    named.push({ name, storageId, bytes: new TextEncoder().encode(text).byteLength });
  }
  return t.mutation(api.problemReports.stage, {
    secret: SECRET,
    app: "Hello Hearken",
    version: "0.1.0",
    os: "windows x86_64",
    crashed: false,
    logs: named,
    now,
  });
}

describe("problem report drafts", () => {
  test("only the server stages and takes; anyone with the code can peek", async () => {
    const t = setup();
    await expect(
      t.mutation(api.problemReports.stage, {
        secret: "wrong",
        app: "Hello Hearken",
        version: "0.1.0",
        os: "linux",
        crashed: false,
        logs: [],
        now: 1,
      }),
    ).rejects.toThrow();
    await expect(t.mutation(api.problemReports.uploadUrl, { secret: "wrong" })).rejects.toThrow();
    const now = Date.now();
    const code = await stage(t, now);
    await expect(t.action(api.problemReports.read, { secret: "wrong", code })).rejects.toThrow();
    await expect(t.mutation(api.problemReports.discard, { secret: "wrong", code })).rejects.toThrow();
    expect(await t.query(api.problemReports.peek, { code })).toEqual({
      app: "Hello Hearken",
      version: "0.1.0",
      crashed: false,
      createdAt: now,
      logs: [{ name: "game.log", bytes: 14 }],
    });
  });

  test("a code is 40 hex digits and differs every time", async () => {
    const t = setup();
    const a = await stage(t, 1);
    const b = await stage(t, 1);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(b).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
  });

  test("read hands back the logs' text until discard deletes the draft and its files", async () => {
    const t = setup();
    const code = await stage(t, Date.now(), { "game.log": "a\n", "crash.log": "b\n" });
    const read = await t.action(api.problemReports.read, { secret: SECRET, code });
    expect(read).toEqual({
      app: "Hello Hearken",
      version: "0.1.0",
      os: "windows x86_64",
      crashed: false,
      logs: [
        { name: "game.log", text: "a\n" },
        { name: "crash.log", text: "b\n" },
      ],
    });
    // Reading leaves the draft for another try.
    expect(await t.action(api.problemReports.read, { secret: SECRET, code })).toEqual(read);
    expect(await t.mutation(api.problemReports.discard, { secret: SECRET, code })).toBe(true);
    expect(await t.mutation(api.problemReports.discard, { secret: SECRET, code })).toBe(false);
    expect(await t.action(api.problemReports.read, { secret: SECRET, code })).toBeNull();
    expect(await t.query(api.problemReports.peek, { code })).toBeNull();
    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(0);
  });

  test("an expired draft is gone to peek and read, and the sweep deletes it with its files", async () => {
    const t = setup();
    const old = Date.now() - DRAFT_TTL_MS - 60_000;
    const stale = await stage(t, old);
    const fresh = await stage(t, Date.now());
    expect(await t.query(api.problemReports.peek, { code: stale })).toBeNull();
    expect(await t.action(api.problemReports.read, { secret: SECRET, code: stale })).toBeNull();
    expect(await t.query(api.problemReports.peek, { code: fresh })).not.toBeNull();
    const swept = await t.mutation(internal.problemReports.expireDrafts, {});
    expect(swept).toBe(1);
    const rows = await t.run((ctx) => ctx.db.query("problemReportDrafts").collect());
    expect(rows.map((row) => row.code)).toEqual([fresh]);
    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(1);
  });

  test("refuses more logs than a game sends", async () => {
    const t = setup();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    const logs = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.log`, storageId, bytes: 1 }));
    await expect(
      t.mutation(api.problemReports.stage, {
        secret: SECRET,
        app: "Hello Hearken",
        version: "0.1.0",
        os: "linux",
        crashed: false,
        logs,
        now: 1,
      }),
    ).rejects.toThrow();
  });
});
