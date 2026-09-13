import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
}));

vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFateDriverDirectorySnapshot: mocks.snapshot,
}));

import { GET } from "./route";

const directory = {
  drivers: [
    { driverId: "road-star-1234", displayName: "Road Star", onDuty: true, activity: "Driving to Denver", detail: "reefer", changedAt: 5 },
    { driverId: "night-owl-5678", displayName: "Night Owl", onDuty: false, lastOnDutyAt: 3 },
    { driverId: "new-hire-9012", displayName: "New Hire", onDuty: false },
  ],
  asOf: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/freight-fate/directory", () => {
  test("answers the cached directory, uncacheable downstream", async () => {
    mocks.snapshot.mockResolvedValue(directory);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(directory);
  });

  test("no backend is a 503 the game reads as unreachable", async () => {
    mocks.snapshot.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
  });
});
