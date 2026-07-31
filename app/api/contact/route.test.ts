import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_SEND_URL = "https://api.resend.com/emails";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  subject: "About AccessiWeather",
  message: "The forecast view reads beautifully in NVDA.",
  turnstileToken: "token-from-widget",
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://orinks.net/api/contact", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

/** Routes fetch by URL so a test can fail the captcha and the send separately. */
function mockFetch(options: {
  turnstile?: { ok?: boolean; status?: number; codes?: string[] };
  resend?: { status?: number };
}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = typeof input === "string" ? input : input.toString();

    if (url === TURNSTILE_VERIFY_URL) {
      const { ok = true, status = 200, codes = [] } = options.turnstile ?? {};
      return new Response(JSON.stringify({ "error-codes": codes, success: ok }), { status });
    }

    if (url === RESEND_SEND_URL) {
      const { status = 200 } = options.resend ?? {};
      return new Response(JSON.stringify({ id: "sent-id" }), { status });
    }

    throw new Error(`unexpected fetch to ${url}`);
  });
}

beforeEach(() => {
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("CONTACT_FROM_EMAIL", "orinks.net <contact@orinks.net>");
  vi.stubEnv("CONTACT_TO_EMAIL", "orin8722@gmail.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/contact", () => {
  it("verifies the captcha and sends the mail for a good submission", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(post(valid));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const sendCall = fetchMock.mock.calls.find(([url]) => url === RESEND_SEND_URL);
    expect(sendCall).toBeDefined();

    const sent = JSON.parse(sendCall![1]!.body as string);
    expect(sent.to).toEqual(["orin8722@gmail.com"]);
    expect(sent.from).toBe("orinks.net <contact@orinks.net>");
    // The sender's address must ride on Reply-To, never on From.
    expect(sent.reply_to).toBe("Ada Lovelace <ada@example.com>");
    expect(sent.subject).toBe("[orinks.net] About AccessiWeather");
  });

  it("passes the caller's IP to Cloudflare when a proxy supplied one", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    await POST(post(valid, { "x-forwarded-for": "203.0.113.7, 70.41.3.18" }));

    const verifyCall = fetchMock.mock.calls.find(([url]) => url === TURNSTILE_VERIFY_URL);
    const body = verifyCall![1]!.body as URLSearchParams;
    expect(body.get("remoteip")).toBe("203.0.113.7");
    expect(body.get("response")).toBe("token-from-widget");
  });

  it("rejects an invalid submission with per-field errors and never sends", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(post({ ...valid, email: "nope", message: "" }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.fieldErrors.email).toBeTruthy();
    expect(payload.fieldErrors.message).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-validates on the server even when the client would have passed", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    // A header-injection attempt that never went through the browser form.
    const response = await POST(post({ ...valid, subject: "Hi\nBcc: victim@example.com" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the captcha when no token was supplied", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(post({ ...valid, turnstileToken: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ captcha: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send when the captcha fails", async () => {
    const fetchMock = mockFetch({ turnstile: { ok: false } });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(post(valid));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ captcha: true });
    expect(fetchMock.mock.calls.some(([url]) => url === RESEND_SEND_URL)).toBe(false);
  });

  it("tells the sender to retry when the token merely expired or was reused", async () => {
    vi.stubGlobal("fetch", mockFetch({ turnstile: { codes: ["timeout-or-duplicate"], ok: false } }));

    const payload = await (await POST(post(valid))).json();

    expect(payload.captcha).toBe(true);
    expect(payload.error).toContain("expired");
  });

  it("reports a configuration problem instead of failing silently", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubGlobal("fetch", mockFetch({}));

    const response = await POST(post(valid));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("orin8722@gmail.com"),
    });
  });

  it("reports a send failure rather than claiming the message went through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetch({ resend: { status: 422 } }));

    const response = await POST(post(valid));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.not.toMatchObject({ ok: true });
  });

  it("survives a body that is not JSON", async () => {
    vi.stubGlobal("fetch", mockFetch({}));

    const response = await POST(
      new Request("https://orinks.net/api/contact", { body: "not json", method: "POST" }),
    );

    expect(response.status).toBe(400);
  });
});
