import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => ({ mutation: mocks.mutation }),
}));

import { POST as create } from "./route";
import { POST as claim } from "./claim/route";

const TOKEN = "a".repeat(32);

function post(path: string, body: unknown) {
  return new Request(`https://orinks.net/api/freight-fate/dispatch-calls${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/freight-fate/dispatch-calls", () => {
  test("normalizes and clamps the create request and returns the public shape", async () => {
    const callId = "a".repeat(48);
    mocks.mutation.mockResolvedValue({ ok: true, callId, ringUntil: 123 });

    const response = await create(
      post("/", {
        driverId: "  CALLER   ROUTE ",
        requestId: "  request   one ",
        kind: "delay",
        facts: {
          remainingMiles: -1,
          hoursLeft: 6,
          truckDamagePct: 10,
          cargoDamagePct: 5,
          weatherAlerts: 2.6,
          summary: "not sent",
        },
        message: "not sent",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ callId, ringUntil: 123 });
    const [, args] = mocks.mutation.mock.calls[0]!;
    expect(args).toMatchObject({
      driverId: "caller-route",
      driverTokenHash: createHash("sha256").update(TOKEN, "utf8").digest("hex"),
      requestId: "request one",
      kind: "delay",
      facts: {
        remainingMiles: 0,
        hoursLeft: 6,
        truckDamagePct: 10,
        cargoDamagePct: 5,
        weatherAlerts: 2,
      },
    });
    expect(args.facts).not.toHaveProperty("summary");
    expect(args).not.toHaveProperty("message");
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  test("maps a lost claim to HTTP 409 with the fixed error", async () => {
    mocks.mutation.mockResolvedValue({ ok: false, reason: "taken" });

    const response = await claim(
      post("/claim", { driverId: "responder-route", callId: "b".repeat(48) }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "taken" });
  });

  test("rejects non-finite facts before calling Convex", async () => {
    const response = await create(
      post("/", {
        driverId: "caller-route",
        requestId: "request-bad",
        kind: "delay",
        facts: {
          remainingMiles: Number.NaN,
          hoursLeft: 6,
          truckDamagePct: 10,
          cargoDamagePct: 5,
          weatherAlerts: 0,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
