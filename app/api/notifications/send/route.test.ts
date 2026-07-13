import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBuildSubscriptions: vi.fn(),
  removeBuildSubscription: vi.fn(),
  revalidateTag: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) =>
    callback,
}));

vi.mock("web-push", () => ({
  default: {
    sendNotification: mocks.sendNotification,
    setVapidDetails: mocks.setVapidDetails,
  },
}));

vi.mock("@/lib/notifications", () => ({
  listBuildSubscriptions: mocks.listBuildSubscriptions,
  removeBuildSubscription: mocks.removeBuildSubscription,
}));

import { POST } from "./route";

function request(token = "test-token") {
  return new Request("https://orinks.net/api/notifications/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ product: "Freight Fate" }),
  });
}

describe("build notification cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBuildSubscriptions.mockResolvedValue([]);
    process.env.BUILD_NOTIFICATION_TOKEN = "test-token";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
    process.env.VAPID_PRIVATE_KEY = "private-key";
  });

  test("makes newly published releases visible before sending notifications", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("github-releases");
    expect(mocks.listBuildSubscriptions).toHaveBeenCalledWith("Freight Fate");
  });

  test("does not invalidate the cache for unauthorized requests", async () => {
    const response = await POST(request("wrong-token"));

    expect(response.status).toBe(401);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
