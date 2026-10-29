// The games route's service end to end against a real Hearken rules module:
// Coin Dash, the example game in orinks-games/hearken, and a run recorded
// by its native tests (both copied into __fixtures__).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Claim } from "@/lib/hearken-online";
import type { GameRecord, GameRecords } from "./records";
import type { GameDefinition } from "./registry";
import { buildService, rulesFolder } from "./service";
import type { GameStores } from "./stores";

const fixtures = join(__dirname, "__fixtures__");
const run = JSON.parse(readFileSync(join(fixtures, "fixtures.json"), "utf8"))[0];

function runFile(build: string) {
  const bytes = new Uint8Array(readFileSync(join(fixtures, run.file)));
  for (let i = 0; i < 32; i++) bytes[5 + i] = parseInt(build.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// The stores and records in memory, behaving as convex/games.ts does.
function memory() {
  const players = new Map([
    ["ada-token-0000000000000000", { id: "p1", name: "Ada" }],
    ["bo-token-00000000000000000", { id: "p2", name: "Bo" }],
  ]);
  const claims = new Map<string, { player: string; nonce: string; reply?: unknown }>();
  const records = new Map<string, GameRecord>();
  let nonce = 0;
  const stores: GameStores = {
    accounts: {
      player: async (token) => players.get(token) ?? null,
      startActivation: async () => ({ device_code: "d", user_code: "WKQR-3468", expires_in: 600, interval: 5 }),
      pollActivation: async () => ({ status: "pending" }),
    },
    runs: {
      async claim(key, record): Promise<Claim> {
        const existing = claims.get(key);
        if (existing) return { claimed: false, existing: { player: existing.player, reply: existing.reply } };
        const mine = { player: record.player, nonce: String(++nonce) };
        claims.set(key, mine);
        return { claimed: true, nonce: mine.nonce };
      },
      async complete(key, claim, reply) {
        const row = claims.get(key);
        if (claim.claimed && row?.nonce === claim.nonce) row.reply = reply;
      },
      async release(key, claim) {
        if (claim.claimed && claims.get(key)?.nonce === claim.nonce) claims.delete(key);
      },
    },
    limiter: { allow: async () => true },
  };
  const store: GameRecords = {
    get: async (c, k) => (records.get(`${c}/${k}`) as never) ?? null,
    put: async (c, k, r) => {
      records.set(`${c}/${k}`, { key: k, playerId: r.playerId ?? null, order: r.order ?? null, value: r.value });
    },
    putBest: async (c, k, r) => {
      const old = records.get(`${c}/${k}`);
      if (old && (old.order ?? 0) >= r.order) return false;
      records.set(`${c}/${k}`, { key: k, playerId: r.playerId ?? null, order: r.order, value: r.value });
      return true;
    },
    list: async (c) =>
      [...records.entries()]
        .filter(([k]) => k.startsWith(`${c}/`))
        .map(([, r]) => r as never)
        .sort((a: GameRecord, b: GameRecord) => (b.order ?? 0) - (a.order ?? 0)),
    ahead: async (c, order) => [...records.entries()].filter(([k, r]) => k.startsWith(`${c}/`) && (r.order ?? 0) > order).length,
  };
  return { stores, store };
}

// A small game in the shape a real one takes: a fixed seed, and a best
// score kept per player in the record store.
const dash: GameDefinition = {
  id: "dash",
  title: "Coin Dash",
  handlers: (records) => ({
    best: {
      expect: () => ({ rules: "coin-dash", seed: run.seed, context: run.context }),
      async accept({ player, verified }) {
        const coins = (verified.outcome as { coins: number }).coins;
        await records.putBest("best", player.id, { value: { name: player.name, coins }, order: coins, playerId: player.id });
        return { coins, rank: (await records.ahead("best", coins)) + 1 };
      },
      async read() {
        return { top: (await records.list<{ name: string; coins: number }>("best")).map((r) => r.value) };
      },
    },
  }),
};

async function service() {
  const rules = rulesFolder("dash", fixtures);
  const [build] = await rules.builds();
  const { stores, store } = memory();
  return { service: buildService(dash, { rules, stores, records: store }), build };
}

const base = "https://orinks.net/api/games/dash";
const send = (s: Awaited<ReturnType<typeof service>>["service"], token: string, body: Uint8Array) =>
  s.fetch(
    new Request(`${base}/runs?kind=best`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
      body: body as BodyInit,
    }),
  );

describe("the games service", () => {
  test("a run is replayed and its handler keeps the verified score", async () => {
    const { service: s, build } = await service();
    const res = await send(s, "ada-token-0000000000000000", runFile(build));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual({ coins: run.outcome.coins, rank: 1 });
    const board = await (await s.fetch(new Request(`${base}/best`))).json();
    expect(board).toEqual({ top: [{ name: "Ada", coins: run.outcome.coins }] });
  });

  test("a copy, an unknown build and a stranger are refused", async () => {
    const { service: s, build } = await service();
    expect((await send(s, "ada-token-0000000000000000", runFile(build))).status).toBe(200);
    expect((await send(s, "bo-token-00000000000000000", runFile(build))).status).toBe(409);
    const other = await send(s, "ada-token-0000000000000000", runFile("11".repeat(32)));
    expect((await other.json()).error).toBe("unknown-build");
    expect((await send(s, "nobody-000000000000000000", runFile(build))).status).toBe(401);
  });

  test("a game with no modules published refuses every run", async () => {
    const rules = rulesFolder("nothing-here", fixtures);
    expect(await rules.builds()).toEqual([]);
  });
});
