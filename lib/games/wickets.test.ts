// Wicket's on the games route: its registry entry, guests, seeds and
// boards, with the stores in memory. Replaying real runs is tested where
// the rules are built, in Wicket's own repository; the published modules
// arrive here with each release.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isGuestName } from "@/lib/hearken-online";
import type { Accounts, Claim, Player } from "@/lib/hearken-online";
import { memoryRecords, recordsBoards } from "@/lib/wickets-online";
import { GAMES } from "./registry";
import { buildService, withTester } from "./service";
import type { GameStores } from "./stores";

const SEED_SECRET = "a test seed secret, at least thirty-two characters";
const base = "https://orinks.net/api/games/wickets";

// Players, guests and connect codes as convex/games.ts keeps them.
function memoryStores() {
  const tokens = new Map<string, Player>();
  let next = 0;
  let pending: { guest?: string } | null = null;
  const issue = (player: Player) => {
    const token = `token-${++next}`.padEnd(24, "0");
    tokens.set(token, player);
    return token;
  };
  const accounts: Accounts = {
    player: async (token) => tokens.get(token) ?? null,
    async startActivation({ guest }) {
      pending = { guest: guest?.guest ? guest.id : undefined };
      return { device_code: "d", user_code: "WKQR-3468", expires_in: 600, interval: 5 };
    },
    // The code is entered at once, by the account "Ada".
    async pollActivation() {
      const token = issue({ id: "p_ada", name: "Ada" });
      const guest = pending?.guest;
      if (guest) for (const [t, p] of tokens) if (p.id === guest) tokens.delete(t);
      return { status: "ready", token, name: "Ada", ...(guest ? { linked: guest } : {}) };
    },
    async createGuest() {
      const player = { id: `g_${++next}`, name: "Copper Fox 12", guest: true };
      return { token: issue(player), name: player.name, player };
    },
    async renameGuest(player) {
      if (!player.guest) return null;
      for (const p of tokens.values()) if (p.id === player.id) p.name = "Sunny Pine 3";
      return "Sunny Pine 3";
    },
  };
  const claims = new Map<string, string>();
  const stores: GameStores = {
    accounts,
    runs: {
      async claim(key): Promise<Claim> {
        if (claims.has(key)) return { claimed: false, existing: {} };
        claims.set(key, "n");
        return { claimed: true, nonce: "n" };
      },
      complete: async () => {},
      release: async (key) => void claims.delete(key),
    },
    limiter: { allow: async () => true },
  };
  return { stores, tokens, issue };
}

function wickets() {
  const { stores, issue } = memoryStores();
  const records = memoryRecords();
  const service = buildService(GAMES.wickets, { rules: { get: async () => null, builds: async () => [] }, stores, records });
  return { service, records, issue };
}

const post = (s: ReturnType<typeof wickets>["service"], path: string, token?: string) =>
  s.fetch(
    new Request(`${base}/${path}`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: "{}",
    }),
  );
const get = (s: ReturnType<typeof wickets>["service"], path: string, token?: string) =>
  s.fetch(new Request(`${base}/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeEach(() => {
  process.env.WICKETS_SEED_SECRET = SEED_SECRET;
});
afterEach(() => {
  delete process.env.WICKETS_SEED_SECRET;
});

describe("Wicket's", () => {
  test("is a game on the route, with a kind per board", () => {
    expect(GAMES.wickets.title).toBe("Wicket's");
    const kinds = Object.keys(GAMES.wickets.handlers(memoryRecords()));
    expect(kinds).toContain("safecracker-daily");
    expect(kinds).toContain("sonar-dive-monthly");
    expect(kinds).toHaveLength(15);
  });

  test("cannot be built without its seed secret", () => {
    delete process.env.WICKETS_SEED_SECRET;
    expect(() => wickets()).toThrow(/seed secret/);
  });

  test("a guest is named by the server, and can ask for another name", async () => {
    const { service } = wickets();
    const made = await (await post(service, "activate/guest")).json();
    expect(made.guest).toBe(true);
    expect(isGuestName(made.name)).toBe(true);
    const renamed = await (await post(service, "activate/rename", made.token)).json();
    expect(renamed).toEqual({ ok: true, name: "Sunny Pine 3" });
  });

  test("a challenge's seed is handed out to a player, and its board can be read", async () => {
    const { service } = wickets();
    const { token } = await (await post(service, "activate/guest")).json();
    expect((await post(service, "start?kind=belfry-daily")).status).toBe(401);
    const plan = await (await post(service, `start?kind=belfry-daily`, token)).json();
    expect(plan.seed).toMatch(/^[0-9]+$/);
    expect(plan.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const top = await (await get(service, "belfry-daily/top", token)).json();
    expect(top).toMatchObject({ key: plan.key, current: true, entries: [], of: 0, you: null });
  });

  test("a guest's entries follow it when it connects an account", async () => {
    const { service, records } = wickets();
    const guest = await (await post(service, "activate/guest")).json();
    const day = (await (await get(service, "belfry-daily/top", guest.token)).json()).key as string;
    const board = `belfry-daily/${day}`;
    const boards = recordsBoards(records);
    const guestId = "g_1";
    await boards.record(board, { player: guestId, name: guest.name, score: 40, at: Date.now() }, "first");

    // The guest renames, then connects as Ada.
    await post(service, "activate/rename", guest.token);
    expect((await boards.top(board, 10)).entries[0].name).toBe("Sunny Pine 3");
    await post(service, "activate/start", guest.token);
    const polled = await (
      await service.fetch(new Request(`${base}/activate/poll`, { method: "POST", body: JSON.stringify({ device_code: "d".repeat(64) }) }))
    ).json();
    expect(polled.status).toBe("ready");
    const top = await boards.top(board, 10, "p_ada");
    expect(top.entries).toEqual([{ rank: 1, name: "Ada", score: 40 }]);
    expect(top.you).toEqual({ rank: 1, score: 40, held: false });
    // The guest's token no longer works.
    expect((await post(service, "start?kind=belfry-daily", guest.token)).status).toBe(401);
  });

  test("the tester read sits beside its boards, which still open by date", async () => {
    const { service } = wickets();
    const { token } = await (await post(service, "activate/guest")).json();
    expect(await (await get(service, "tester", token)).json()).toEqual({ tester: false });
    expect((await get(service, "belfry-daily/top", token)).status).toBe(200);

    let open = false;
    const gated = new Proxy({ a: { expect() {}, accept() {} } } as unknown as Record<string, never>, {
      has: (t, k) => k !== "a" || open,
      getOwnPropertyDescriptor: (t, k) => (k !== "a" || open ? Reflect.getOwnPropertyDescriptor(t, k) : undefined),
      get: (t, k) => (k !== "a" || open ? Reflect.get(t, k) : undefined),
    });
    const handlers = withTester(gated);
    expect(Object.keys(handlers)).toEqual(["tester"]);
    open = true;
    expect(Object.keys(handlers)).toEqual(["tester", "a"]);
    expect(Object.hasOwn(handlers, "a")).toBe(true);
  });
});
