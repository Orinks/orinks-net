/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  RATE_LIMIT_RETENTION_MS,
  RATE_LIMIT_WINDOW_MS,
  consumeFreightFateWrite,
} from "./freightFateRateLimit";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function seedCounter(t: ReturnType<typeof setup>, key: string, windowStart: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("freightFateRateLimits", {
      key,
      count: 1,
      windowStart,
      updatedAt: windowStart,
    });
  });
}

async function remainingKeys(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("freightFateRateLimits").collect();
    return rows.map((row) => row.key).sort();
  });
}

describe("write rate limiter", () => {
  const now = 1_800_000_000_000;

  async function consume(t: ReturnType<typeof setup>, at: number) {
    return t.run(async (ctx) => consumeFreightFateWrite(ctx, {
      scope: "presence", driverId: "driver-a", now: at, limit: 2,
    }));
  }

  async function counters(t: ReturnType<typeof setup>) {
    return t.run(async (ctx) => ctx.db.query("freightFateRateLimits").collect());
  }

  test("a driver keeps one counter no matter how long they play", async () => {
    const t = setup();

    expect(await consume(t, now)).toBe(true);
    expect(await consume(t, now + 1)).toBe(true);
    // Third write inside the same minute is over the limit of two.
    expect(await consume(t, now + 2)).toBe(false);

    // The next minute rolls the same row over rather than leaving the spent
    // one behind: keying each window separately is what used to grow this
    // table by a row per driver-minute of play.
    expect(await consume(t, now + RATE_LIMIT_WINDOW_MS)).toBe(true);

    const rows = await counters(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("presence:driver-a");
    expect(rows[0].count).toBe(1);
  });

  test("a slow clock does not buy a fresh allowance", async () => {
    const t = setup();

    expect(await consume(t, now)).toBe(true);
    expect(await consume(t, now + 1)).toBe(true);
    // Same driver, timestamp reported from the previous minute: the window
    // only rolls forward, so this still counts against the current one.
    expect(await consume(t, now - RATE_LIMIT_WINDOW_MS)).toBe(false);
    expect(await counters(t)).toHaveLength(1);
  });
});

describe("rate limit cleanup", () => {
  test("drops spent counters and keeps the live window", async () => {
    const t = setup();
    const now = 1_800_000_000_000;

    await seedCounter(t, "presence:driver-a:old", now - RATE_LIMIT_RETENTION_MS - RATE_LIMIT_WINDOW_MS);
    await seedCounter(t, "presence:driver-b:current", now - (now % RATE_LIMIT_WINDOW_MS));
    await seedCounter(t, "save-upload:driver-c:recent", now - RATE_LIMIT_WINDOW_MS);

    const result = await t.mutation(internal.freightFateRateLimit.cleanupFreightFateRateLimits, {
      now,
    });

    expect(result.deleted).toBe(1);
    expect(result.moreWaiting).toBe(false);
    // The counter still inside its retention window has to survive, or a
    // driver mid-minute gets a fresh allowance and the limit stops limiting.
    expect(await remainingKeys(t)).toEqual([
      "presence:driver-b:current",
      "save-upload:driver-c:recent",
    ]);
  });

  test("reports a backlog rather than trying to clear it in one pass", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const stale = now - RATE_LIMIT_RETENTION_MS - RATE_LIMIT_WINDOW_MS;

    for (let i = 0; i < 600; i += 1) {
      await seedCounter(t, `presence:driver-${i}:stale`, stale);
    }

    const first = await t.mutation(internal.freightFateRateLimit.cleanupFreightFateRateLimits, {
      now,
    });
    expect(first.moreWaiting).toBe(true);

    const second = await t.mutation(internal.freightFateRateLimit.cleanupFreightFateRateLimits, {
      now,
    });
    expect(second.moreWaiting).toBe(false);
    expect(first.deleted + second.deleted).toBe(600);
    expect(await remainingKeys(t)).toEqual([]);
  });
});
