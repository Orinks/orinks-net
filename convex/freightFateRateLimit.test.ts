/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { RATE_LIMIT_RETENTION_MS, RATE_LIMIT_WINDOW_MS } from "./freightFateRateLimit";

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
