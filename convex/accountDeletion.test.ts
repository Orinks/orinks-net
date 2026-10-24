/// <reference types="vite/client" />
import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { WEBHOOK_TOLERANCE_MS } from "./accountDeletion";

const modules = import.meta.glob("./**/*.ts");

const SIGNING_KEY = "c2l0ZS13ZWJob29rLXNpZ25pbmcta2V5LTAwMDAwMDA=";

function setup() {
  return convexTest(schema, modules);
}

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${SIGNING_KEY}`;
});

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
});

/**
 * A driver with one row in each kind of table that hangs off it, plus the
 * trivia player the same account claimed. Written straight to the tables:
 * what matters here is that the purge reaches every one of them, not how the
 * rows got there.
 */
async function seedAccount(t: ReturnType<typeof setup>, subject: string, name: string) {
  const now = Date.now();
  const { driverId } = await t.withIdentity({ subject }).mutation(api.freightFate.provisionDriver, {
    displayName: name,
    visibility: "public",
    expandedSharingConsent: true,
    now,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("freightFateDeviceTokens", {
      driverId, tokenHash: `${driverId}-token`, label: "Desktop", createdAt: now,
    });
    await ctx.db.insert("freightFatePresence", {
      driverId, displayName: name, activity: "Driving", detail: "on I-80",
      listed: true, changedAt: now, updatedAt: now,
    });
    await ctx.db.insert("freightFatePresenceBeats", { driverId, updatedAt: now });
    const contentId = await ctx.db.insert("freightFateSaveContent", {
      driverId, content: new ArrayBuffer(8),
    });
    await ctx.db.insert("freightFateSaves", {
      driverId, saveName: name, revision: 1, saveVersion: 1, contentHash: "abc",
      sizeBytes: 8, summary: "Level 1", contentId, createdAt: now,
    });
    await ctx.db.insert("freightFateDriverEvents", {
      driverId, eventId: `${driverId}-event`, eventType: "delivery_completed",
      summary: "Delivered freight.", occurredAt: now, createdAt: now,
    });
    await ctx.db.insert("freightFateAchievements", {
      driverId, achievementKey: "first_delivery", earnedAt: now, createdAt: now,
    });
    await ctx.db.insert("freightFateProfileSnapshots", {
      driverId, version: 1, level: 3, careerTitle: "Company Driver",
      deliveries: 12, milesDriven: 4_100, reputation: 70,
      capturedAt: now, updatedAt: now,
    });
    await ctx.db.insert("freightFateStationSuggestions", {
      driverId, kind: "web", name: `${name} Radio`,
      streamUrl: `https://radio.example/${driverId}`, streamKey: `${driverId}-stream`,
      streamFormat: "mp3", catalogChecked: true, status: "pending", createdAt: now,
    });

    const playerId = await ctx.db.insert("triviaPlayers", {
      playerKey: `${subject}-key`, authSubject: subject, displayName: name,
      createdAt: now, lastSeenAt: now, totalRuns: 1, bestScore: 10,
      deepestRound: 2, totalCorrect: 3, totalAnswered: 4, tapesUnlocked: [],
    });
    await ctx.db.insert("triviaAchievements", {
      playerId, achievementKey: "first_run", unlockedAt: now,
    });
  });

  return driverId;
}

/** Every row either account owns, by the keys the purge works from. */
async function remaining(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => ({
    drivers: (await ctx.db.query("freightFateDrivers").collect()).map((row) => row.driverId),
    deviceTokens: (await ctx.db.query("freightFateDeviceTokens").collect()).map((row) => row.driverId),
    presence: (await ctx.db.query("freightFatePresence").collect()).map((row) => row.driverId),
    beats: (await ctx.db.query("freightFatePresenceBeats").collect()).map((row) => row.driverId),
    saves: (await ctx.db.query("freightFateSaves").collect()).map((row) => row.driverId),
    saveContent: (await ctx.db.query("freightFateSaveContent").collect()).map((row) => row.driverId),
    events: (await ctx.db.query("freightFateDriverEvents").collect()).map((row) => row.driverId),
    achievements: (await ctx.db.query("freightFateAchievements").collect()).map((row) => row.driverId),
    snapshots: (await ctx.db.query("freightFateProfileSnapshots").collect()).map((row) => row.driverId),
    stations: (await ctx.db.query("freightFateStationSuggestions").collect()).map((row) => row.driverId),
    triviaPlayers: (await ctx.db.query("triviaPlayers").collect()).map((row) => row.displayName),
    triviaAchievements: (await ctx.db.query("triviaAchievements").collect()).length,
  }));
}

/**
 * Svix's scheme, implemented independently of the code under test: HMAC-SHA256
 * over "<id>.<timestamp>.<body>" with the base64-decoded signing key, itself
 * base64. If the two ever disagree, Clerk's deliveries are all rejected.
 */
function signed(body: string, at = Date.now(), id = "msg_test") {
  const timestamp = Math.floor(at / 1000).toString();
  const mac = createHmac("sha256", Buffer.from(SIGNING_KEY, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${mac}`,
  };
}

function userDeleted(subject: string) {
  return JSON.stringify({ type: "user.deleted", data: { id: subject, deleted: true } });
}

describe("deleting an account", () => {
  test("takes the driver, its history and the trivia player with it", async () => {
    const t = setup();
    await seedAccount(t, "user_going", "Gone Driver");
    const staying = await seedAccount(t, "user_staying", "Still Here");

    const purged = await t.mutation(internal.accountDeletion.purgeDeletedAccount, {
      authSubject: "user_going",
    });
    expect(purged.freightFateRows).toBe(10);
    expect(purged.triviaRows).toBe(2);

    const left = await remaining(t);
    expect(left).toMatchObject({
      drivers: [staying],
      deviceTokens: [staying],
      presence: [staying],
      beats: [staying],
      saves: [staying],
      saveContent: [staying],
      events: [staying],
      achievements: [staying],
      snapshots: [staying],
      stations: [staying],
      triviaPlayers: ["Still Here"],
      triviaAchievements: 1,
    });
  });

  test("frees the display name the deleted account was holding", async () => {
    const t = setup();
    await seedAccount(t, "user_going", "RoadRunner");

    // The symptom that found this: the name stayed taken forever.
    await expect(
      t.withIdentity({ subject: "user_new" }).mutation(api.freightFate.provisionDriver, {
        displayName: "RoadRunner", visibility: "public", now: Date.now(),
      }),
    ).rejects.toThrow();

    await t.mutation(internal.accountDeletion.purgeDeletedAccount, { authSubject: "user_going" });

    const reused = await t
      .withIdentity({ subject: "user_new" })
      .mutation(api.freightFate.provisionDriver, {
        displayName: "RoadRunner", visibility: "public", now: Date.now(),
      });
    expect(reused.driverId).toMatch(/^roadrunner-/);
  });

  test("purging an account that never set anything up is a no-op", async () => {
    const t = setup();
    const purged = await t.mutation(internal.accountDeletion.purgeDeletedAccount, {
      authSubject: "user_stranger",
    });
    expect(purged).toMatchObject({ driverId: null, freightFateRows: 0, triviaRows: 0 });
  });
});

describe("the Clerk webhook", () => {
  async function post(t: ReturnType<typeof setup>, body: string, headers: Record<string, string>) {
    return await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  }

  test("purges the account a correctly signed user.deleted names", async () => {
    const t = setup();
    await seedAccount(t, "user_going", "Gone Driver");

    const body = userDeleted("user_going");
    const delivered = await post(t, body, signed(body));

    expect(delivered.status).toBe(200);
    expect((await remaining(t)).drivers).toEqual([]);
  });

  test("refuses a forged, replayed or unsigned delivery", async () => {
    const t = setup();
    const driverId = await seedAccount(t, "user_going", "Gone Driver");
    const body = userDeleted("user_going");

    // A signature for a different account's deletion, pasted onto this body.
    const forged = await post(t, body, signed(userDeleted("user_other")));
    expect(forged.status).toBe(400);

    const replayed = await post(t, body, signed(body, Date.now() - WEBHOOK_TOLERANCE_MS - 1_000));
    expect(replayed.status).toBe(400);

    const unsigned = await post(t, body, {});
    expect(unsigned.status).toBe(400);

    expect((await remaining(t)).drivers).toEqual([driverId]);
  });

  test("acknowledges events it does not act on", async () => {
    const t = setup();
    const driverId = await seedAccount(t, "user_going", "Gone Driver");

    const body = JSON.stringify({ type: "user.updated", data: { id: "user_going" } });
    const ignored = await post(t, body, signed(body));

    expect(ignored.status).toBe(200);
    expect((await remaining(t)).drivers).toEqual([driverId]);
  });
});
