// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_AGENT, requestJson } from "./lib/request.mjs";

describe("editorial HTTP requests", () => {
  it("sends a descriptive user agent and retries transient failures within the ceiling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const sleeps = [];

    const result = await requestJson("https://example.test/data", {
      fetchImpl,
      maxRetries: 2,
      sleepImpl: async (ms) => sleeps.push(ms),
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
    expect(sleeps).toHaveLength(1);
  });

  it("stops after the configured retry ceiling", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));

    await expect(
      requestJson("https://example.test/data", {
        fetchImpl,
        maxRetries: 1,
        sleepImpl: async () => {},
      }),
    ).rejects.toThrow("after 2 attempts");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
