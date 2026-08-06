import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
  client: null as unknown,
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) =>
    callback,
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => mocks.client,
}));

import {
  FREIGHT_FATE_ACTIVATION_INTERVAL_S,
  hashFreightFateToken,
  pollFreightFateActivation,
  startFreightFateActivation,
} from "./freight-fate-online";
import { hashDeviceCode, mintDeviceCode } from "@/convex/freightFateActivation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = { mutation: mocks.mutation, query: mocks.query };
});

// The two hashes have to agree or nothing works, and nothing complains.
// hashDeviceCode runs inside Convex on Web Crypto; hashFreightFateToken runs
// on the Next route on node:crypto. A start stores the first, every poll
// looks the row up by the second. If they ever diverged, checkActivation
// would find no row, answer "expired", and the game would report an ordinary
// code timeout -- for every player, forever, with a green test suite.
describe("the device-code hash agrees across both runtimes", () => {
  test("Web Crypto and node:crypto produce the same digest", async () => {
    const inputs = [
      "",
      "a",
      mintDeviceCode(),
      "0".repeat(64),
      "f".repeat(64),
      // Non-ASCII: the two must agree on utf8 bytes, not on code units. A
      // node:crypto update() without an explicit encoding defaults to utf8,
      // which is what makes these match -- worth pinning, since "latin1"
      // would still pass for every hex string above.
      "café-naïve",
      "日本語のテスト",
      "emoji 🚚 and combining é",
    ];

    for (const input of inputs) {
      expect(await hashDeviceCode(input)).toBe(hashFreightFateToken(input));
    }
  });

  test("the digest is lowercase hex of the expected width", async () => {
    expect(await hashDeviceCode("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("startFreightFateActivation", () => {
  test("returns the snake_case fields the game reads, with a dashed user code", async () => {
    mocks.mutation.mockResolvedValue({
      deviceCode: "a".repeat(64),
      userCode: "WKQR3468",
      expiresAt: Date.now() + 600_000,
    });

    const started = await startFreightFateActivation({
      clientKey: "203.0.113.7",
      siteOrigin: "https://orinks.net",
    });

    expect(started).toMatchObject({
      device_code: "a".repeat(64),
      user_code: "WKQR-3468",
      verification_uri: "https://orinks.net/activate",
      verification_uri_complete: "https://orinks.net/activate?code=WKQR-3468",
      interval: FREIGHT_FATE_ACTIVATION_INTERVAL_S,
    });
    expect(started!.expires_in).toBeGreaterThan(0);
    expect(started!.expires_in).toBeLessThanOrEqual(600);
  });

  test("truncates an overlong client key rather than passing it through", async () => {
    mocks.mutation.mockResolvedValue({
      deviceCode: "b".repeat(64),
      userCode: "WKQR3468",
      expiresAt: Date.now() + 600_000,
    });

    await startFreightFateActivation({ clientKey: "x".repeat(200), siteOrigin: "https://orinks.net" });

    expect(mocks.mutation.mock.calls[0]![1].clientKey).toHaveLength(64);
  });

  test("answers null when online is not configured", async () => {
    mocks.client = null;
    await expect(
      startFreightFateActivation({ clientKey: "1.2.3.4", siteOrigin: "https://orinks.net" }),
    ).resolves.toBeNull();
  });
});

describe("pollFreightFateActivation", () => {
  const deviceCode = "c".repeat(64);

  test("hashes the secret before it ever reaches the database", async () => {
    mocks.query.mockResolvedValue("pending");

    await pollFreightFateActivation({ deviceCode });

    const args = mocks.query.mock.calls[0]![1];
    expect(args.deviceCodeHash).toBe(await hashDeviceCode(deviceCode));
    expect(JSON.stringify(args)).not.toContain(deviceCode);
  });

  test("does not redeem while the player has not confirmed yet", async () => {
    mocks.query.mockResolvedValue("pending");

    await expect(pollFreightFateActivation({ deviceCode })).resolves.toEqual({ status: "pending" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  test("passes an expired code straight back without a redeem", async () => {
    mocks.query.mockResolvedValue("expired");

    await expect(pollFreightFateActivation({ deviceCode })).resolves.toEqual({ status: "expired" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  test("redeems once the code is ready and hands back the driver and name", async () => {
    mocks.query.mockResolvedValue("ready");
    mocks.mutation.mockResolvedValue({
      driverId: "rig-hauler-1234",
      token: "ffd_token",
      displayName: "Rig Hauler",
    });

    await expect(pollFreightFateActivation({ deviceCode })).resolves.toEqual({
      status: "ready",
      driverId: "rig-hauler-1234",
      token: "ffd_token",
      displayName: "Rig Hauler",
    });
  });

  // Redeem answers null both when another poll got there first and when the
  // driver is at the computer cap. Either way the code is spent, and expired
  // is the answer the game already knows how to recover from.
  test("reports expired when the redeem comes back empty", async () => {
    mocks.query.mockResolvedValue("ready");
    mocks.mutation.mockResolvedValue(null);

    await expect(pollFreightFateActivation({ deviceCode })).resolves.toEqual({ status: "expired" });
  });

  test("answers null when online is not configured", async () => {
    mocks.client = null;
    await expect(pollFreightFateActivation({ deviceCode })).resolves.toBeNull();
  });
});
