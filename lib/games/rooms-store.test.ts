// The rooms store over SQLite (rooms-store.js), as the GameRooms Durable
// Object keeps it, here over node:sqlite; and the account lookups the
// object remembers between requests (service.ts).
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import type { Player } from "@/lib/hearken-online";
import { oneAtATime, sqlRooms } from "./rooms-store.js";
import { rememberedAccounts } from "./service";
import type { GameStores } from "./stores";

/** `ctx.storage.sql` over an in-memory database. */
function memorySql() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = db.prepare(query);
      const returns = /^\s*SELECT/i.test(query) || /RETURNING/i.test(query);
      // node:sqlite takes the same bindings the Durable Object does.
      const args = bindings as (string | number | null)[];
      const rows = returns ? (statement.all(...args) as Record<string, unknown>[]) : (statement.run(...args), []);
      return { toArray: () => rows };
    },
  };
}

function room(over: Record<string, unknown> = {}) {
  return {
    kind: "pebbles",
    code: "",
    phase: "waiting",
    open: false,
    direct: false,
    createdAt: 1,
    updatedAt: 1,
    members: [{ id: "p1", seat: 0, state: "taken" }],
    ...over,
  };
}

describe("sqlRooms", () => {
  test("numbers events in order, and a save of an older read keeps the seq", async () => {
    const store = sqlRooms(memorySql());
    const made = await store.create(room());
    const read = await store.get(made.id);
    expect(await store.append(made.id, { type: "join", at: 2 })).toBe(1);
    expect(await store.append(made.id, { type: "turn", at: 3 })).toBe(2);
    // Rooms handed out this request see the new seq.
    expect(read?.seq).toBe(2);
    store.forget();
    const stale = { ...read!, seq: 0, phase: "playing" };
    await store.save(stale);
    const again = await store.get(made.id);
    expect(again?.seq).toBe(2);
    expect(again?.phase).toBe("playing");
    expect((await store.eventsAfter(made.id, 0)).map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
    expect((await store.eventsAfter(made.id, 1)).map((e: { type: string }) => e.type)).toEqual(["turn"]);
    expect((await store.eventsBefore(made.id, null, 1)).map((e: { seq: number }) => e.seq)).toEqual([2]);
    await store.prune(made.id, 3);
    expect((await store.eventsAfter(made.id, 0)).map((e: { seq: number }) => e.seq)).toEqual([2]);
    expect(await store.append(made.id, { type: "left", at: 4 })).toBe(3);
  });

  test("keeps codes unique among rooms not over, and finds rooms by code, name and member", async () => {
    const store = sqlRooms(memorySql());
    const a = await store.create(room({ code: "ABCDEF", open: true }));
    const b = await store.create(room({ code: "ABCDEF" }));
    expect(a.code).toBe("ABCDEF");
    expect(b.code).not.toBe("ABCDEF");
    expect((await store.byCode("ABCDEF"))?.id).toBe(a.id);
    expect((await store.openRooms("pebbles")).map((r: { id: string }) => r.id)).toEqual([a.id]);
    await store.save({ ...a, phase: "finished", open: false });
    expect(await store.byCode("ABCDEF")).toBeNull();
    const c = await store.create(room({ code: "ABCDEF" }));
    expect(c.code).toBe("ABCDEF");

    const lounge = await store.create(room({ kind: "chat", name: "lounge" }));
    expect((await store.byName("chat", "lounge"))?.id).toBe(lounge.id);
    const direct = await store.create(
      room({
        direct: true,
        members: [
          { id: "p1", seat: 0 },
          { id: "p2", seat: 1 },
        ],
      }),
    );
    expect((await store.directBetween("pebbles", "p2", "p1"))?.id).toBe(direct.id);
    const mine = await store.listFor("p2");
    expect(mine.map((r: { id: string }) => r.id)).toEqual([direct.id]);
  });

  test("remembers players and mutes", async () => {
    const store = sqlRooms(memorySql());
    await store.rememberPlayer({ id: "p1", name: "Ann", handle: "ann-1" });
    await store.rememberPlayer({ id: "p1", name: "Ann B", handle: "ann-1" });
    expect(await store.playerByHandle("ann-1")).toEqual({ id: "p1", name: "Ann B", guest: false, handle: "ann-1" });
    const ann = { id: "p1", handle: "ann-1" };
    await store.setMute(ann, "bo-2", "block", { id: "p2" });
    const bo = await store.relations("p2");
    expect([...bo.blockedBy]).toEqual(["ann-1"]);
    expect([...(await store.relations("p1")).blocked]).toEqual(["bo-2"]);
    await store.setMute(ann, "bo-2", "none");
    expect([...(await store.relations("p2")).blockedBy]).toEqual([]);
  });

  test("keeps invites and one-sided friends", async () => {
    const store = sqlRooms(memorySql());
    const invite = { id: "i1", from: { id: "p1" }, to: { id: "p2" }, kind: "pebbles", state: "sent", at: 5 };
    await store.saveInvite(invite);
    await store.saveInvite({ id: "i2", from: { id: "p3" }, to: { id: "p1" }, kind: "pebbles", state: "sent", at: 9 });
    await store.saveInvite({ ...invite, state: "heard" });
    expect((await store.getInvite("i1"))?.state).toBe("heard");
    expect((await store.invitesFor("p1")).map((i: { id: string }) => i.id)).toEqual(["i2", "i1"]);
    expect((await store.invitesFor("p2")).map((i: { id: string }) => i.id)).toEqual(["i1"]);
    await store.dropInvite("i1");
    expect(await store.getInvite("i1")).toBeNull();
    expect(await store.invitesFor("p2")).toEqual([]);

    await store.setFriend("p1", "bo-2", true);
    await store.setFriend("p1", "bo-2", true);
    await store.setFriend("p1", "al-3", true);
    expect(await store.friendsOf("p1")).toEqual(["al-3", "bo-2"]);
    expect(await store.friendsOf("p2")).toEqual([]);
    await store.setFriend("p1", "bo-2", false);
    expect(await store.friendsOf("p1")).toEqual(["al-3"]);
  });
});

describe("oneAtATime", () => {
  test("runs one request at a time, and looks the account up first", async () => {
    const store = sqlRooms(memorySql());
    const order: string[] = [];
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const service = {
      async fetch(request: Request) {
        const name = new URL(request.url).pathname;
        order.push(`start ${name}`);
        if (name === "/slow") await held;
        order.push(`end ${name}`);
        return new Response(name);
      },
    };
    const warmed: string[] = [];
    const serve = oneAtATime(store, service, async (token) => {
      warmed.push(token);
    });
    const slow = serve(new Request("https://x.test/slow", { headers: { authorization: "Bearer a" } }));
    const fast = serve(new Request("https://x.test/fast", { headers: { authorization: "Bearer b" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(warmed).toEqual(["a", "b"]);
    expect(order).toEqual(["start /slow"]);
    release();
    await Promise.all([slow, fast]);
    expect(order).toEqual(["start /slow", "end /slow", "start /fast", "end /fast"]);
  });

  test("a request that throws does not hold up the next", async () => {
    const store = sqlRooms(memorySql());
    let first = true;
    const serve = oneAtATime(store, {
      async fetch() {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        return new Response("ok");
      },
    });
    await expect(serve(new Request("https://x.test/a"))).rejects.toThrow("boom");
    expect(await (await serve(new Request("https://x.test/b"))).text()).toBe("ok");
  });
});

describe("rememberedAccounts", () => {
  test("asks about a token once in a while, and about an unknown one sooner", async () => {
    let asked = 0;
    let t = 0;
    const ann: Player = { id: "p1", name: "Ann" };
    const accounts = {
      async player(token: string) {
        asked += 1;
        return token === "good" ? ann : null;
      },
    } as unknown as GameStores["accounts"];
    const remembered = rememberedAccounts(accounts, { ttlMs: 60_000, now: () => t });
    expect(await remembered.player("good")).toEqual(ann);
    expect(await remembered.player("good")).toEqual(ann);
    expect(asked).toBe(1);
    t = 60_001;
    await remembered.player("good");
    expect(asked).toBe(2);
    expect(await remembered.player("bad")).toBeNull();
    t += 10_001;
    await remembered.player("bad");
    expect(asked).toBe(4);
  });
});

describe("polls", () => {
  function memorySqlCounting() {
    const db = new DatabaseSync(":memory:");
    const counts = { updates: 0 };
    return {
      counts,
      exec(query: string, ...bindings: unknown[]) {
        if (/^\s*UPDATE rooms/i.test(query)) counts.updates += 1;
        const statement = db.prepare(query);
        const returns = /^\s*SELECT/i.test(query) || /RETURNING/i.test(query);
        const args = bindings as (string | number | null)[];
        const rows = returns ? (statement.all(...args) as Record<string, unknown>[]) : (statement.run(...args), []);
        return { toArray: () => rows };
      },
    };
  }

  test("a save that only marks a reader seen writes the row at most once a minute, and the seen time is kept", async () => {
    const sql = memorySqlCounting();
    const clock = { t: 1000 };
    const store = sqlRooms(sql, { now: () => clock.t });
    const made = await store.create(room());
    const id = made.id as string;
    for (let i = 1; i <= 10; i += 1) {
      store.forget();
      const r = (await store.get(id))!;
      clock.t += 2000;
      r.members[0].lastSeen = clock.t;
      await store.save(r);
    }
    expect(sql.counts.updates).toBe(0);
    store.forget();
    expect((await store.get(id))!.members[0].lastSeen).toBe(clock.t);
    // Anything else changing writes at once.
    const r = (await store.get(id))!;
    r.phase = "playing";
    await store.save(r);
    expect(sql.counts.updates).toBe(1);
    // A minute on, a poll writes again.
    clock.t += 61_000;
    store.forget();
    const later = (await store.get(id))!;
    later.members[0].lastSeen = clock.t;
    await store.save(later);
    expect(sql.counts.updates).toBe(2);
  });
});
