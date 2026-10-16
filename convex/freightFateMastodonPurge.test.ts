/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { PURGE_BATCH } from "./freightFateMastodonPurge";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("leftover Mastodon purge", () => {
  test("revokes each grant at its instance, then deletes links and apps", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const count = PURGE_BATCH + 3;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateMastodonApps", {
        instanceHost: "mastodon.example",
        clientId: "client-id",
        clientSecret: "client-secret",
        createdAt: 1,
      });
      for (let i = 0; i < count; i += 1) {
        await ctx.db.insert("freightFateMastodonLinks", {
          driverId: `driver-${i}`,
          instanceHost: i === 0 ? "orphan.example" : "mastodon.example",
          accessToken: `token-${i}`,
          handle: `@d${i}@mastodon.example`,
          createdAt: 1,
        });
      }
    });

    const result = await t.action(internal.freightFateMastodonPurge.purgeMastodonLinks, {});

    expect(result).toEqual({ links: count, apps: 1 });
    // The orphan link has no app to revoke with, so it is only deleted.
    expect(fetchMock).toHaveBeenCalledTimes(count - 1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mastodon.example/oauth/revoke");
    expect(JSON.parse(init.body as string)).toMatchObject({
      client_id: "client-id",
      client_secret: "client-secret",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateMastodonLinks").first()).toBeNull();
      expect(await ctx.db.query("freightFateMastodonApps").first()).toBeNull();
    });
  });

  test("a failed revoke still deletes the row", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("instance down");
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateMastodonApps", {
        instanceHost: "mastodon.example",
        clientId: "client-id",
        clientSecret: "client-secret",
        createdAt: 1,
      });
      await ctx.db.insert("freightFateMastodonLinks", {
        driverId: "driver-1",
        instanceHost: "mastodon.example",
        accessToken: "token-1",
        handle: "@d1@mastodon.example",
        createdAt: 1,
      });
    });

    const result = await t.action(internal.freightFateMastodonPurge.purgeMastodonLinks, {});

    expect(result).toEqual({ links: 1, apps: 1 });
  });

  test("does nothing once the tables are empty", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await t.action(internal.freightFateMastodonPurge.purgeMastodonLinks, {})).toEqual({
      links: 0,
      apps: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
