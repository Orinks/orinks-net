import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ poll: vi.fn() }));

vi.mock("@/lib/freight-fate-online", () => ({
  pollFreightFateActivation: mocks.poll,
}));

import { POST } from "./route";

const DEVICE_CODE = "a".repeat(64);

function post(body: unknown) {
  return new Request("https://orinks.net/api/freight-fate/activate/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Same contract note as the start route: the game reading these fields lives
// in another repository. `display_name` in particular is load-bearing -- it
// is the name the game speaks aloud after connecting, and the only thing
// that tells a blind player their code was confirmed by a stranger's
// account. A rename here has to fail a test.
describe("POST /api/freight-fate/activate/poll", () => {
  test("200 and status pending while the player has not confirmed", async () => {
    mocks.poll.mockResolvedValue({ status: "pending" });

    const response = await POST(post({ device_code: DEVICE_CODE }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(mocks.poll).toHaveBeenCalledWith({ deviceCode: DEVICE_CODE });
  });

  test("200 and the token, driver id, and spoken name once ready", async () => {
    mocks.poll.mockResolvedValue({
      status: "ready",
      driverId: "rig-hauler-1234",
      token: "ffd_0123456789abcdef",
      displayName: "Rig Hauler",
    });

    const response = await POST(post({ device_code: DEVICE_CODE }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["display_name", "driver_id", "status", "token"]);
    expect(payload).toEqual({
      status: "ready",
      driver_id: "rig-hauler-1234",
      token: "ffd_0123456789abcdef",
      display_name: "Rig Hauler",
    });
  });

  test("410 once the code is spent or expired", async () => {
    mocks.poll.mockResolvedValue({ status: "expired" });

    const response = await POST(post({ device_code: DEVICE_CODE }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ status: "expired" });
  });

  test("400 for a malformed device code, without touching the backend", async () => {
    for (const bad of [
      undefined,
      "",
      "not-hex",
      "A".repeat(64), // uppercase hex is not what start issues
      "a".repeat(63),
      "a".repeat(65),
      42,
      null,
    ]) {
      const response = await POST(post({ device_code: bad }));
      expect(response.status, String(bad)).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    }
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  test("400 for a body that is not JSON at all", async () => {
    const response = await POST(post("not json"));

    expect(response.status).toBe(400);
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  test("503, never 400, when the backend fails on a well-formed request", async () => {
    // The request was fine. Telling the game it was malformed would send it
    // down a "your code is wrong" path in front of a player whose code is
    // perfectly good.
    mocks.poll.mockRejectedValue(new Error("convex is down"));

    const response = await POST(post({ device_code: DEVICE_CODE }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });

  test("503 when online is not configured", async () => {
    mocks.poll.mockResolvedValue(null);

    const response = await POST(post({ device_code: DEVICE_CODE }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });

  test("never answers 429: this route has no limiter of its own", async () => {
    mocks.poll.mockResolvedValue({ status: "pending" });

    expect((await POST(post({ device_code: DEVICE_CODE }))).status).not.toBe(429);
  });
});
