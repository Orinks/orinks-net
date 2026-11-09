import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler, type Deps } from "./route";

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
