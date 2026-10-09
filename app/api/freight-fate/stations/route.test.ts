import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  suggest: vi.fn(),
}));

vi.mock("@/lib/freight-fate-stations", () => ({
  getFreightFateCommunityStations: mocks.list,
  suggestFreightFateStation: mocks.suggest,
}));

import { GET, POST } from "./route";

const TOKEN = "t".repeat(32);

function suggestion(body: Record<string, unknown>, token: string | null = TOKEN) {
  return new Request("https://orinks.net/api/freight-fate/stations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "FreightFate/v1.9.1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.suggest.mockReset();
});

describe("GET /api/freight-fate/stations", () => {
  test("serves the community station list", async () => {
    mocks.list.mockResolvedValue({ schema: 1, stations: [{ id: "community-abc", name: "Night Owl" }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schema: 1, stations: [{ id: "community-abc", name: "Night Owl" }] });
  });

  test("says so when the backend is not configured", async () => {
    mocks.list.mockResolvedValue(null);
    expect((await GET()).status).toBe(503);
  });
});

describe("POST /api/freight-fate/stations", () => {
  test("passes the form and the game build through", async () => {
    mocks.suggest.mockResolvedValue({ ok: true, message: "Thanks." });
    const response = await POST(
      suggestion({ driverId: "night-owl-1234", kind: "web", name: "Night Owl", streamUrl: "https://s.example", extra: 1 }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Thanks." });
    expect(mocks.suggest).toHaveBeenCalledWith({
      driverId: "night-owl-1234",
      driverToken: TOKEN,
      clientVersion: "v1.9.1",
      form: { kind: "web", name: "Night Owl", streamUrl: "https://s.example" },
    });
  });

  test("a refusal keeps its spoken message", async () => {
    mocks.suggest.mockResolvedValue({ ok: false, reason: "duplicate_catalog", message: "That station is already on the dial." });
    const response = await POST(suggestion({ driverId: "night-owl-1234", kind: "web" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ message: "That station is already on the dial." });
  });

  test("no token is unauthorized, with a sentence for the player", async () => {
    const response = await POST(suggestion({ driverId: "night-owl-1234" }, null));
    expect(response.status).toBe(401);
    expect((await response.json()).message).toBeTruthy();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
});
