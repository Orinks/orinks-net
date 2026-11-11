import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), configured: true }));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => (mocks.configured ? { query: mocks.query, mutation: mocks.mutation } : null),
}));

import { GET as getMine } from "@/app/api/freight-fate/dispatch/route";
import { POST as postOrder } from "@/app/api/freight-fate/dispatch/orders/route";
import { POST as postReply } from "@/app/api/freight-fate/dispatch/replies/route";
import { hashFreightFateToken } from "@/lib/freight-fate-online";

const TOKEN = "ffd_test_token_0123456789abcdef";

function request(path: string, method: string, body?: unknown) {
  return new Request(`https://orinks.net/api/freight-fate/dispatch${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.mutation.mockReset();
  mocks.configured = true;
});

describe("live dispatch routes", () => {
  test("a GET takes the driver id from the query string and sends the hashed token", async () => {
    mocks.query.mockResolvedValue({ ok: true, carrier: null, orders: [], ownsCarrierId: null });
    const reply = await getMine(request("?driverId=Road-Star-1234", "GET"));
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("no-store");
    const args = mocks.query.mock.calls[0][1];
    expect(args).toMatchObject({ driverId: "road-star-1234", driverTokenHash: hashFreightFateToken(TOKEN) });
    expect(typeof args.now).toBe("number");
  });

  test("a POST passes only the fields its function takes", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, duplicate: false, orderId: "o1", status: "open", expiresAt: 1 });
    await postOrder(request("/orders", "POST", {
      driverId: "night-owl-1234",
      orderId: "o1",
      memberDriverId: "road-star-1234",
      kind: "note",
      payload: { text: "hi" },
      now: 0,
      driverTokenHash: "forged",
    }));
    const args = mocks.mutation.mock.calls[0][1];
    expect(args.driverTokenHash).toBe(hashFreightFateToken(TOKEN));
    expect(args.now).not.toBe(0);
    expect(Object.keys(args).sort()).toEqual(
      ["driverId", "driverTokenHash", "kind", "memberDriverId", "now", "orderId", "payload"],
    );
  });

  test("refusals map to statuses and keep their detail", async () => {
    mocks.mutation.mockResolvedValue({ ok: false, reason: "order_closed", status: "lapsed" });
    const closed = await postReply(request("/replies", "POST", { driverId: "road-star-1234", replyId: "r", kind: "accepted", orderId: "o" }));
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ ok: false, error: "order_closed", status: "lapsed" });

    mocks.query.mockResolvedValue({ ok: false, reason: "not_enabled" });
    expect((await getMine(request("?driverId=road-star-1234", "GET"))).status).toBe(403);
  });

  test("a missing token is a 400, and an unconfigured site a 503", async () => {
    const bare = new Request("https://orinks.net/api/freight-fate/dispatch?driverId=road-star-1234");
    expect((await getMine(bare)).status).toBe(400);
    mocks.configured = false;
    expect((await getMine(request("?driverId=road-star-1234", "GET"))).status).toBe(503);
  });
});
