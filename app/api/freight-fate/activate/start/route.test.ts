import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@/lib/freight-fate-online", () => ({
  startFreightFateActivation: mocks.start,
}));

import { POST } from "./route";

function post(headers: Record<string, string> = {}) {
  return new Request("https://orinks.net/api/freight-fate/activate/start", {
    method: "POST",
    headers,
  });
}

const started = {
  device_code: "a".repeat(64),
  user_code: "WKQR-3468",
  verification_uri: "https://orinks.net/activate",
  verification_uri_complete: "https://orinks.net/activate?code=WKQR-3468",
  expires_in: 600,
  interval: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue(started);
});

// This route's JSON is a contract with the game, which lives in another
// repository and ships on its own schedule. Renaming a field here is not a
// refactor; it is a breaking change to software that cannot be fixed from
// this side. These names are asserted literally for that reason.
describe("POST /api/freight-fate/activate/start", () => {
  test("hands back the snake_case device-flow fields the game reads", async () => {
    const response = await POST(post());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual([
      "device_code",
      "expires_in",
      "interval",
      "user_code",
      "verification_uri",
      "verification_uri_complete",
    ]);
    expect(payload.device_code).toBe(started.device_code);
    expect(payload.user_code).toBe("WKQR-3468");
    expect(payload.verification_uri).toBe("https://orinks.net/activate");
    expect(payload.interval).toBe(3);
  });

  test("keys the rate limiter on the first forwarded address, not the whole chain", async () => {
    await POST(post({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }));

    expect(mocks.start).toHaveBeenCalledWith({
      clientKey: "203.0.113.7",
      siteOrigin: "https://orinks.net",
    });
  });

  test("falls back to a placeholder key when no proxy supplied one", async () => {
    await POST(post());

    expect(mocks.start.mock.calls[0]![0].clientKey).toBe("unknown");
  });

  test("429 only for a genuine rate limit", async () => {
    mocks.start.mockRejectedValue(new ConvexError({ code: "rate_limited" }));

    const response = await POST(post());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
  });

  test("503, not 429, when code minting gives up", async () => {
    // A game that hears "rate limited" backs off politely and retries a
    // minute later. Nothing about an exhausted code-minting retry loop or a
    // Convex outage gets better on that schedule, so they must not share a
    // status with it.
    mocks.start.mockRejectedValue(new ConvexError({ code: "activation_unavailable" }));

    expect((await POST(post())).status).toBe(503);
  });

  test("503 when the backend throws something that is not a ConvexError at all", async () => {
    mocks.start.mockRejectedValue(new Error("socket hang up"));

    const response = await POST(post());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });

  test("503 when online is not configured", async () => {
    mocks.start.mockResolvedValue(null);

    expect((await POST(post())).status).toBe(503);
  });
});
