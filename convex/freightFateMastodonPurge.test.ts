/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { PURGE_BATCH } from "./freightFateMastodonPurge";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("leftover Mastodon purge", () => {
  test("deletes every link and app without contacting any server", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateMastodonApps", {
        instanceHost: "mastodon.example",
        clientId: "client-id",
        clientSecret: "client-secret",
        createdAt: 1,
      });
      for (let i = 0; i < PURGE_BATCH + 3; i += 1) {
        await ctx.db.insert("freightFateMastodonLinks", {
          driverId: `driver-${i}`,
          instanceHost: "mastodon.example",
          accessToken: `token-${i}`,
          handle: `@d${i}@mastodon.example`,
          createdAt: 1,
        });
      }
    });

    expect(await t.mutation(internal.freightFateMastodonPurge.purgeMastodonRows, {})).toEqual({
      links: PURGE_BATCH,
      apps: 0,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).not.toHaveBeenCalled();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateMastodonLinks").first()).toBeNull();
      expect(await ctx.db.query("freightFateMastodonApps").first()).toBeNull();
    });
  });

  test("does nothing once the tables are empty", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.freightFateMastodonPurge.purgeMastodonRows, {})).toEqual({
      links: 0,
      apps: 0,
    });
  });
});
