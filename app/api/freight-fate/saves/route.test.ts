import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  list: vi.fn(),
  deleteSlot: vi.fn(),
}));

vi.mock("@/lib/freight-fate-online", () => ({
  FREIGHT_FATE_MAX_SAVE_BYTES: 900 * 1024,
  decodeFreightFateSaveContent: (value: unknown) => {
    const bytes = Buffer.from(String(value), "base64");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  },
  deleteFreightFateSaveSlot: mocks.deleteSlot,
  freightFateClientVersion: () => undefined,
  listFreightFateSaves: mocks.list,
  normalizeFreightFateDriverId: (value: unknown) => String(value),
  normalizeFreightFateSaveName: (value: unknown) => String(value),
  normalizeFreightFateToken: (value: unknown) => String(value),
  postFreightFateSave: mocks.post,
}));

import { POST } from "./route";

function post() {
  return new Request("https://orinks.net/api/freight-fate/saves", {
    method: "POST",
    headers: {
      authorization: "Bearer ffd_test_token_0123456789",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      driverId: "driver-1234",
      saveName: "Incoming",
      saveVersion: 19,
      parentRevision: null,
      contentHash: "a".repeat(64),
      content: Buffer.from("save").toString("base64"),
      summary: "Incoming career",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/freight-fate/saves", () => {
  test("passes the evicted career name through unchanged", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      revision: 1,
      evictedSaveName: "Old Career",
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      revision: 1,
      evictedSaveName: "Old Career",
    });
  });

  test("omits the eviction field for an ordinary upload", async () => {
    mocks.post.mockResolvedValue({ ok: true, revision: 2 });

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, revision: 2 });
  });
});
