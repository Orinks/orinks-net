// Chat moderation (chat-moderation.js) over node:sqlite, as the GameRooms
// Durable Object keeps it, and the owner's route into it.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { chatModeration, hasBlockedWords, hasContact, offLine, WARNING } from "./chat-moderation.js";
import { MODERATION_HEADER, moderationRoute } from "./moderation-route.js";

function memorySql() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = db.prepare(query);
      const returns = /^\s*SELECT/i.test(query) || /RETURNING/i.test(query);
      const args = bindings as (string | number | null)[];
      const rows = returns ? (statement.all(...args) as Record<string, unknown>[]) : (statement.run(...args), []);
      return { toArray: () => rows };
    },
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function setup() {
  const clock = { t: 1_800_000_000_000 };
  const mails: string[] = [];
  const log: string[] = [];
  const m = chatModeration(memorySql(), {
    now: () => clock.t,
    mail: async (subject: string) => {
      mails.push(subject);
    },
    log: (line: string) => log.push(line),
    pageUrl: "https://orinks.net/games/moderation",
  });
  return { m, clock, mails, log };
}

const ada = { id: "a", name: "Ada" };
const bo = { id: "b", name: "Bo", handle: "bbbbbbbbbbbbbbbb", guest: false };
const room = { id: "r1", kind: "pebbles" };

function reportBy(id: string, guest = false) {
  return {
    reporter: { id, name: `R${id}`, handle: `h${id}`, guest },
    about: bo,
    room,
    lines: [{ seq: 4, type: "chat", at: 1, name: "Bo", text: "a rude line" }],
    context: [],
    marked: null,
    note: null,
    at: 0,
  };
}

describe("screen", () => {
  test("lets a plain line and a ready line through", () => {
    const { m } = setup();
    expect(m.screen({ text: "nice move", quick: null, player: ada })).toBe(true);
    expect(m.screen({ text: "Good luck.", quick: "good-luck", player: ada })).toBe(true);
  });

  test("turns away links, email addresses, phone numbers and the word list", () => {
    const { m } = setup();
    for (const text of ["see www.example.com", "join example dot com", "me@example.org", "call 555 123 4567", "you fucking idiot"]) {
      expect(m.screen({ text, quick: null, player: { id: text, name: "Ada" } }), text).toBe(false);
    }
    // A word list match never crosses two words.
    expect(hasBlockedWords("ana zinc")).toBe(false);
    expect(hasContact("I scored 12 then 40")).toBe(false);
  });

  test("the same line a third time running is turned away", () => {
    const { m } = setup();
    expect(m.screen({ text: "again?", quick: null, player: ada })).toBe(true);
    expect(m.screen({ text: "Again?", quick: null, player: ada })).toBe(true);
    expect(m.screen({ text: "again?", quick: null, player: ada })).toBe(false);
  });

  test("five screened lines in ten minutes turn chat off for ten minutes, ready lines too", () => {
    const { m, clock } = setup();
    for (let i = 0; i < 4; i += 1) expect(m.screen({ text: "www.x.com", quick: null, player: ada })).toBe(false);
    expect(m.screen({ text: "www.x.com", quick: null, player: ada })).toEqual({ code: "chat-off", message: "Your chat is off for a few minutes." });
    expect(m.screen({ text: "Hello.", quick: "hello", player: ada })).toMatchObject({ code: "chat-off" });
    clock.t += 11 * 60_000;
    expect(m.screen({ text: "hello", quick: null, player: ada })).toBe(true);
  });

  test("a guest's typed line is the backstop's to refuse", () => {
    const { m } = setup();
    expect(m.screen({ text: "hi", quick: null, player: { ...ada, guest: true } })).toBe(false);
    expect(m.screen({ text: "Good luck.", quick: "good-luck", player: { ...ada, guest: true } })).toBe(true);
  });

  test("the chat-off line names how long", () => {
    expect(offLine(null, 0)).toBe("Your chat is off.");
    expect(offLine(DAY, 0)).toBe("Your chat is off until tomorrow.");
    expect(offLine(7 * DAY, 0)).toBe("Your chat is off for 7 more days.");
  });
});

describe("reports", () => {
  test("reports about one player are one case, and the owner hears once an hour at most", async () => {
    const { m, mails, clock } = setup();
    await m.report(reportBy("1"));
    await m.report(reportBy("2"));
    const cases = m.cases();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ state: "open", about: { name: "Bo" } });
    expect(cases[0].reports).toHaveLength(2);
    expect(cases[0].reports[0].lines[0].text).toBe("a rude line");
    expect(mails).toEqual(["Chat report: Bo"]);
    // Another player's new case within the hour: no second email.
    await m.report({ ...reportBy("1"), about: { ...bo, id: "c", name: "Cy", handle: "cccccccccccccccc" } });
    expect(mails).toHaveLength(1);
    clock.t += HOUR;
    await m.report({ ...reportBy("1"), about: { ...bo, id: "d", name: "Di", handle: "dddddddddddddddd" } });
    expect(mails).toHaveLength(2);
  });

  test("three accounts within a day turn chat off for a day; guests and ignored reporters do not count", async () => {
    const { m, clock, log } = setup();
    await m.report(reportBy("1"));
    await m.report(reportBy("g", true));
    await m.report(reportBy("2"));
    m.ignore("2", "R2", true);
    await m.report(reportBy("3"));
    expect(m.cases()[0].state).toBe("open");
    await m.report(reportBy("4"));
    const [c] = m.cases();
    expect(c.state).toBe("auto");
    expect(m.screen({ text: "hi", quick: null, player: bo })).toEqual({ code: "chat-off", message: "Your chat is off until tomorrow." });
    expect(m.standing(bo)).toMatchObject({ chat: "off", message: "Your chat is off for a day." });
    // The message is heard once.
    expect(m.standing(bo)).not.toHaveProperty("message");
    expect(log).toContain(`[moderation] case ${c.id}: open -> auto`);
    // The day passes: chat back, the case open again for the owner.
    clock.t += DAY;
    expect(m.standing(bo)).toBeNull();
    expect(m.cases()[0].state).toBe("open");
    // Not again within the week until the owner has looked.
    await m.report(reportBy("5"));
    expect(m.cases()[0].state).toBe("open");
  });

  test("the owner dismisses, warns, or turns chat off; Dismiss lifts the automatic step", async () => {
    const { m, clock } = setup();
    for (const r of ["1", "2", "3"]) await m.report(reportBy(r));
    const id = m.cases()[0].id;
    expect(m.act(id, "dismiss")).toBe("dismissed");
    expect(m.standing(bo)).toBeNull();
    expect(m.act(id, "warn")).toBeNull();

    await m.report(reportBy("1"));
    const second = m.cases()[0];
    expect(second.past).toHaveLength(1);
    m.act(second.id, "warn");
    expect(m.standing(bo)).toEqual({ chat: "open", message: WARNING });
    expect(m.standing(bo)).toBeNull();

    await m.report(reportBy("1"));
    m.act(m.cases()[0].id, "off-week");
    expect(m.sanctions()).toEqual([expect.objectContaining({ name: "Bo", reason: "owner" })]);
    clock.t += 3 * DAY;
    expect(m.screen({ text: "hi", quick: null, player: bo })).toEqual({ code: "chat-off", message: "Your chat is off for 4 more days." });

    await m.report(reportBy("1"));
    m.act(m.cases()[0].id, "off-good");
    clock.t += 400 * DAY;
    expect(m.screen({ text: "hi", quick: null, player: bo })).toEqual({ code: "chat-off", message: "Your chat is off." });
    m.lift(bo.id);
    expect(m.screen({ text: "hi", quick: null, player: bo })).toBe(true);
  });

  test("old report lines are dropped 90 days after the case closes", async () => {
    const { m, clock } = setup();
    await m.report(reportBy("1"));
    m.act(m.cases()[0].id, "dismiss");
    clock.t += 91 * DAY;
    m.screen({ text: "hi", quick: null, player: ada });
    expect(m.cases()[0].reports[0].lines).toEqual([]);
  });
});

describe("the owner's route", () => {
  const secret = "s".repeat(40);
  const ask = (m: ReturnType<typeof chatModeration>, init: RequestInit & { key?: string } = {}) =>
    moderationRoute(
      new Request("https://orinks.net/api/games/wickets/moderation", {
        ...init,
        headers: init.key === undefined ? {} : { [MODERATION_HEADER]: init.key },
      }),
      m,
      secret,
    );

  test("answers only with the server secret", async () => {
    const { m } = setup();
    expect((await ask(m)).status).toBe(403);
    expect((await ask(m, { key: "wrong" })).status).toBe(403);
    const res = await ask(m, { key: secret });
    expect(await res.json()).toEqual({ ok: true, cases: [], sanctions: [] });
  });

  test("acts on a case", async () => {
    const { m } = setup();
    await m.report(reportBy("1"));
    const id = m.cases()[0].id;
    const res = await ask(m, { key: secret, method: "POST", body: JSON.stringify({ do: "act", case: id, action: "off-day" }) });
    expect(await res.json()).toEqual({ ok: true, outcome: "chat off for a day" });
    const again = await ask(m, { key: secret, method: "POST", body: JSON.stringify({ do: "act", case: id, action: "warn" }) });
    expect(again.status).toBe(404);
  });
});
