import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conditions: vi.fn(),
}));

vi.mock("@/lib/weather", () => ({
  getCurrentConditions: mocks.conditions,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/current-conditions", () => {
  test("success is CDN cacheable for five minutes", async () => {
    mocks.conditions.mockResolvedValue({ lines: ["ok"] });
    const response = await GET();

    expect(response.headers.get("vercel-cdn-cache-control")).toBe("max-age=300, stale-while-revalidate=300");
    expect(await response.json()).toEqual({ lines: ["ok"] });
  });

  test("failure is not cached", async () => {
    mocks.conditions.mockRejectedValue(new Error("down"));
    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
  });
});
