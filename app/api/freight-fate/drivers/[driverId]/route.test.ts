import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
}));

vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFateDriverProfileSummary: mocks.summary,
  normalizeFreightFateDriverId: (value: unknown) => {
    if (typeof value !== "string" || value.length < 8) throw new Error("Driver ID is too short.");
    return value.toLowerCase();
  },
}));

import { GET } from "./route";

function get(driverId: string) {
  return GET(
    new Request(`https://orinks.net/api/freight-fate/drivers/${driverId}`),
    { params: Promise.resolve({ driverId }) },
  );
}

const profile = {
  driver: { driverId: "road-star-1234", displayName: "Road Star", visibility: "public", createdAt: 1, updatedAt: 2 },
  snapshot: { level: 4, careerTitle: "Rookie" },
  presence: null,
  achievementCount: 1,
  recentAchievements: [],
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/freight-fate/drivers/[driverId]", () => {
  test("answers a public profile from the cached summary, uncacheable downstream", async () => {
    mocks.summary.mockResolvedValue({ configured: true, profile });

    const response = await get("Road-Star-1234");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(profile);
    // Normalized before it reaches the cache, so one driver is one entry.
    expect(mocks.summary).toHaveBeenCalledWith("road-star-1234");
  });

  test("a profile that is not public is a 404 the game can name", async () => {
    mocks.summary.mockResolvedValue({ configured: true, profile: null });

    const response = await get("hidden-driver-1234");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "profile_not_public" });
  });

  test("no backend is a 503, not a hidden profile", async () => {
    mocks.summary.mockResolvedValue({ configured: false, profile: null });

    const response = await get("road-star-1234");

    expect(response.status).toBe(503);
  });

  test("a malformed driver id is refused before anything is read", async () => {
    const response = await get("x");

    expect(response.status).toBe(400);
    expect(mocks.summary).not.toHaveBeenCalled();
  });
});
