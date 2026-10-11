import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  increment: vi.fn(),
}));

vi.mock("@/lib/convex", () => ({
  getVisitCount: mocks.get,
  incrementVisitCount: mocks.increment,
}));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/visits", () => {
  test("GET is CDN cacheable for a short time", async () => {
    mocks.get.mockResolvedValue({ lifetime: 10, today: 2 });
    const response = await GET();

    expect(response.headers.get("vercel-cdn-cache-control")).toBe("max-age=60, stale-while-revalidate=60");
    expect(await response.json()).toEqual({ lifetime: 10, today: 2, durable: true });
  });

  test("GET errors are not given cache headers", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  test("POST is never cached", async () => {
    mocks.increment.mockResolvedValue({ lifetime: 11, today: 3 });
    const response = await POST();

    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
    expect(mocks.increment).toHaveBeenCalledTimes(1);
  });
});
