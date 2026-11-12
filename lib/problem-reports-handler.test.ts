import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler, createOpenHandler, createSendHandler, type Deps } from "./problem-reports-handler";

const report = {
  app: "Freight Fate",
  version: "1.9.6",
  os: "windows x86_64",
  description: "The dock menu is empty.",
  crashed: false,
  attachments: [{ name: "session.log", text: "12:00 INFO started\n" }],
};

function post(body: unknown, options: { gzip?: boolean; headers?: Record<string, string> } = {}) {
  const json = Buffer.from(JSON.stringify(body));
  return new Request("https://orinks.net/api/problem-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.gzip ? { "Content-Encoding": "gzip" } : {}),
      ...(options.headers ?? {}),
    },
    body: options.gzip ? gzipSync(json) : json,
  });
}

function deps(overrides: Partial<Deps> = {}) {
  const sent: Record<string, unknown>[] = [];
  const counts = new Map<string, number>();
  const d: Deps & { sent: Record<string, unknown>[] } = {
    sent,
    allow: async (key, limit) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n <= limit;
    },
    takesMail: async () => true,
    sendMail: async (body) => {
      sent.push(body);
      return new Response(JSON.stringify({ id: "sent" }), { status: 200 });
    },
    stage: async () => "0".repeat(40),
    read: async () => null,
    discard: async () => {},
    ...overrides,
  };
  return d;
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("CONTACT_FROM_EMAIL", "orinks.net <contact@orinks.net>");
  vi.stubEnv("CONTACT_TO_EMAIL", "orin8722@gmail.com");
  vi.stubEnv("PROBLEM_REPORT_BLOCK", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/problem-reports", () => {
  it("emails a gzipped report with its log attached and answers 202", async () => {
    const d = deps();
    const response = await createHandler(d)(post({ ...report, reply_to: "driver@example.com" }, { gzip: true }));
    expect(response.status).toBe(202);
    expect(d.sent).toHaveLength(1);
    const mail = d.sent[0];
    expect(mail.to).toEqual(["orin8722@gmail.com"]);
    expect(mail.from).toBe("orinks.net <contact@orinks.net>");
    expect(mail.subject).toBe("[Freight Fate 1.9.6] The dock menu is empty.");
    expect(mail.reply_to).toBe("driver@example.com");
    expect(mail.attachments).toEqual([
      { filename: "session.log", content: Buffer.from("12:00 INFO started\n").toString("base64") },
    ]);
    expect(mail.text).toContain("App: Freight Fate 1.9.6");
  });

  it("takes a plain JSON body too, and leaves out what the report does not have", async () => {
    const d = deps();
    const response = await createHandler(d)(post(report));
    expect(response.status).toBe(202);
    expect(d.sent[0]).not.toHaveProperty("reply_to");
  });

  it("refuses a malformed report and a game it does not take, without emailing", async () => {
    const d = deps();
    const handler = createHandler(d);
    expect((await handler(post({ ...report, description: "" }))).status).toBe(400);
    expect((await handler(post({ ...report, app: "Paperback" }))).status).toBe(403);
    expect((await handler(post({ ...report, description: "x".repeat(20_001) }))).status).toBe(413);
    const broken = new Request("https://orinks.net/api/problem-reports", {
      method: "POST",
      headers: { "Content-Encoding": "gzip" },
      body: Buffer.from("not gzip"),
    });
    expect((await handler(broken)).status).toBe(400);
    expect(d.sent).toHaveLength(0);
  });

  it("refuses a gzipped report that unpacks past the cap from its trailer, before unpacking it", async () => {
    const d = deps();
    const huge = { ...report, attachments: [{ name: "game.log", text: "x".repeat(7 * 1024 * 1024) }] };
    const response = await createHandler(d)(post(huge, { gzip: true }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "the report is too big" });
    const notGzip = new Request("https://orinks.net/api/problem-reports", {
      method: "POST",
      headers: { "Content-Encoding": "gzip" },
      body: Buffer.concat([Buffer.from("not a gzip stream, with a trailer that reads huge"), Buffer.from([0xff, 0xff, 0xff, 0x7f])]),
    });
    expect(await (await createHandler(d)(notGzip)).json()).toEqual({ error: "the report could not be unpacked" });
    expect(d.sent).toHaveLength(0);
  });

  it("answers 422 when the reply address's domain takes no mail, and takes the report when the lookup fails", async () => {
    const no = deps({ takesMail: async () => false });
    expect((await createHandler(no)(post({ ...report, reply_to: "driver@exmaple.com" }))).status).toBe(422);
    expect(no.sent).toHaveLength(0);
    const unknown = deps({ takesMail: async () => null });
    expect((await createHandler(unknown)(post({ ...report, reply_to: "driver@example.com" }))).status).toBe(202);
  });

  it("limits reports per address and per day", async () => {
    const d = deps();
    const handler = createHandler(d);
    for (let i = 0; i < 5; i++) {
      expect((await handler(post(report, { headers: { "x-forwarded-for": "203.0.113.7" } }))).status).toBe(202);
    }
    expect((await handler(post(report, { headers: { "x-forwarded-for": "203.0.113.7" } }))).status).toBe(429);
    expect((await handler(post(report, { headers: { "x-forwarded-for": "203.0.113.8" } }))).status).toBe(202);
    const full = deps({ allow: async (key) => key !== "all" });
    expect((await createHandler(full)(post(report))).status).toBe(429);
  });

  it("refuses a blocked address before reading the report", async () => {
    vi.stubEnv("PROBLEM_REPORT_BLOCK", "198.51.100.0/24");
    const d = deps();
    const response = await createHandler(d)(post(report, { headers: { "x-forwarded-for": "198.51.100.9" } }));
    expect(response.status).toBe(403);
    expect(d.sent).toHaveLength(0);
  });

  it("answers 502 when the email does not go out, and 503 when mail is not set up", async () => {
    const down = deps({ sendMail: async () => new Response("no", { status: 500 }) });
    expect((await createHandler(down)(post(report))).status).toBe(502);
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await createHandler(deps())(post(report))).status).toBe(503);
  });
});

describe("POST /api/problem-reports/open", () => {
  const { description: _dropped, ...sentAhead } = report;

  it("keeps the logs and answers 201 with the link, without emailing", async () => {
    const staged: unknown[] = [];
    const d = deps({
      stage: async (r) => {
        staged.push(r);
        return "ab".repeat(20);
      },
    });
    const response = await createOpenHandler(d)(post(sentAhead, { gzip: true }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ code: "ab".repeat(20), url: `https://orinks.net/report/${"ab".repeat(20)}` });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ description: "", attachments: report.attachments });
    expect(d.sent).toHaveLength(0);
  });

  it("still checks the report, the game and the limits", async () => {
    const d = deps();
    const open = createOpenHandler(d);
    expect((await open(post({ ...sentAhead, app: "Solitaire" }))).status).toBe(403);
    expect((await open(post({ ...sentAhead, version: 9 }))).status).toBe(400);
    for (let i = 0; i < 5; i += 1) expect((await open(post(sentAhead))).status).toBe(201);
    expect((await open(post(sentAhead))).status).toBe(429);
  });

  it("answers 503 when drafts are not set up and 502 when the logs could not be kept", async () => {
    expect((await createOpenHandler(deps({ stage: async () => null }))(post(sentAhead))).status).toBe(503);
    const failing = deps({
      stage: async () => {
        throw new Error("upload answered 500");
      },
    });
    expect((await createOpenHandler(failing)(post(sentAhead))).status).toBe(502);
  });
});

describe("POST /api/problem-reports/<code>", () => {
  const code = "cd".repeat(20);
  const draft = {
    app: "Hello Hearken",
    version: "0.1.0",
    os: "windows x86_64",
    crashed: true,
    logs: [
      { name: "game.log", text: "a\n" },
      { name: "crash.log", text: "b\n" },
    ],
  };

  function submit(body: unknown) {
    return new Request(`https://orinks.net/api/problem-reports/${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Deps holding one draft, until it is discarded. */
  function withDraft(overrides: Partial<Deps> = {}) {
    let left: typeof draft | null = draft;
    return deps({
      read: async (c) => (c === code ? left : null),
      discard: async (c) => {
        if (c === code) left = null;
      },
      ...overrides,
    });
  }

  it("emails what the player wrote with the logs sent ahead, less the ones left out, and drops the draft", async () => {
    const d = withDraft();
    const send = createSendHandler(d);
    const response = await send(submit({ description: "It closed.", reply_to: "me@example.com", omit: ["crash.log"] }), code);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toMatchObject({ reply_to: "me@example.com", subject: expect.stringContaining("Hello Hearken") });
    expect((d.sent[0] as { text: string }).text).toContain("What happened:\nIt closed.");
    expect((d.sent[0] as { attachments: { filename: string }[] }).attachments.map((a) => a.filename)).toEqual(["game.log"]);
    // The link is spent.
    const again = await send(submit({ description: "It closed.", omit: [] }), code);
    expect(again.status).toBe(404);
    expect(d.sent).toHaveLength(1);
  });

  it("refuses a code the site did not give out, and one with no draft, as 404", async () => {
    const d = withDraft();
    const send = createSendHandler(d);
    expect((await send(submit({ description: "x", omit: [] }), "../contact")).status).toBe(404);
    expect((await send(submit({ description: "x", omit: [] }), "ef".repeat(20))).status).toBe(404);
    expect(d.sent).toHaveLength(0);
  });

  it("names the field of a refusal and leaves the draft unspent", async () => {
    const d = withDraft({ takesMail: async () => false });
    const send = createSendHandler(d);
    expect(await (await send(submit({ description: " ", omit: [] }), code)).json()).toEqual({
      error: "Say what happened.",
      field: "description",
    });
    expect(await (await send(submit({ description: "x", reply_to: "nobody", omit: [] }), code)).json()).toMatchObject({
      field: "reply_to",
    });
    const noMail = await send(submit({ description: "x", reply_to: "me@nowhere.invalid", omit: [] }), code);
    expect(noMail.status).toBe(422);
    expect(await noMail.json()).toMatchObject({ field: "reply_to" });
    expect((await send(new Request(`https://orinks.net/api/problem-reports/${code}`, { method: "POST", body: "{" }), code)).status).toBe(400);
    // Every refusal above left the draft for the next try.
    expect((await send(submit({ description: "x", omit: [] }), code)).status).toBe(202);
  });

  it("answers 503 when mail is not set up, before spending the draft", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const d = withDraft();
    expect((await createSendHandler(d)(submit({ description: "x", omit: [] }), code)).status).toBe(503);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect((await createSendHandler(d)(submit({ description: "x", omit: [] }), code)).status).toBe(202);
  });

  it("keeps the draft when the email does not go out, so the player can try again", async () => {
    let fail = true;
    const d = withDraft({
      sendMail: async () => {
        if (fail) throw new Error("resend is down");
        return new Response(JSON.stringify({ id: "sent" }), { status: 200 });
      },
    });
    const send = createSendHandler(d);
    expect((await send(submit({ description: "x", omit: [] }), code)).status).toBe(502);
    fail = false;
    expect((await send(submit({ description: "x", omit: [] }), code)).status).toBe(202);
    expect((await send(submit({ description: "x", omit: [] }), code)).status).toBe(404);
  });
});
