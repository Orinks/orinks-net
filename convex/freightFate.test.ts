/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  DRIVER_EVENT_CLOCK_SKEW_MS,
  DRIVER_EVENT_WRITE_LIMIT,
  MAX_DRIVER_EVENTS,
  PRESENCE_WRITE_LIMIT,
} from "./freightFate";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

// Mirrors hashFreightFateToken in lib/freight-fate-online.ts. That helper runs
// on the game's nodejs REST route via node:crypto; SHA-256 hex over the same
// utf8 bytes is identical to this Web Crypto version, so this reproduces the
// exact hash the game's Bearer token yields at verification. If provisionDriver
// and this ever disagree, the game silently fails auth — so the round-trip
// tests below are the guardrail on that contract.
async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Local copy of normalizeFreightFateDriverId's canonicalization, used to assert
// the issued driverId round-trips unchanged when the game echoes it back.
function normalizeDriverId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const SUBJECT = "user_2abcDEF";
const OTHER = "user_2zzzZZZ";

describe("provisionDriver / getMyDriver", () => {
  test("requires authentication", async () => {
    const t = setup();
    await expect(
      t.mutation(api.freightFate.provisionDriver, {
        displayName: "Rig Hauler",
        visibility: "public",
        now: Date.now(),
      }),
    ).rejects.toThrow();
    expect(await t.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("provisions a driver keyed to the account and returns a one-time token", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const result = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "  Rig   Hauler  ",
      visibility: "public",
      now,
    });

    expect(result.rotated).toBe(false);
    expect(typeof result.token).toBe("string");
    expect(result.token!.length).toBeGreaterThanOrEqual(24);
    // The public slug is already canonical, so the game echoing it back and the
    // REST route re-normalizing it yields the same id.
    expect(normalizeDriverId(result.driverId)).toBe(result.driverId);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine).not.toBeNull();
    expect(mine!.driverId).toBe(result.driverId);
    expect(mine!.displayName).toBe("Rig Hauler"); // whitespace normalized
    expect(mine!.visibility).toBe("public");
    expect(mine!.hasToken).toBe(true);
    expect(mine).not.toHaveProperty("token"); // the plaintext token never leaks

    // A different account cannot see this driver.
    const other = t.withIdentity({ subject: OTHER });
    expect(await other.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("issued token authenticates the game's presence path; wrong token is rejected", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    // The game sends driverId + Bearer token; the REST route hashes the token
    // with hashFreightFateToken and calls updatePresence. Simulate that path.
    const ok = await t.mutation(api.freightFate.updatePresence, {
      driverId: normalizeDriverId(driverId),
      driverTokenHash: await sha256Hex(token!),
      activity: "Hauling reefer to Denver",
      detail: "I-70 westbound",
      now,
    });
    expect(ok.ok).toBe(true);

    const bad = await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash: await sha256Hex("ffd_not_the_real_token_value_here"),
      activity: "x",
      detail: "y",
      now,
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unauthorized");

    // Public + on duty => listed on the live board.
    const board = await t.query(api.freightFate.getPresenceBoard, { now });
    expect(board.drivers.map((driver) => driver.driverId)).toContain(driverId);
  });

  test("a display name used by another account is rejected, case-insensitively", async () => {
    const t = setup();
    const now = Date.now();
    const first = t.withIdentity({ subject: SUBJECT });
    await first.mutation(api.freightFate.provisionDriver, {
      displayName: "Orinks",
      visibility: "public",
      now,
    });

    const second = t.withIdentity({ subject: OTHER });
    for (const clash of ["Orinks", "orinks", "  ORINKS  "]) {
      await expect(
        second.mutation(api.freightFate.provisionDriver, {
          displayName: clash,
          visibility: "private",
          now,
        }),
      ).rejects.toMatchObject({ data: { code: "name_taken" } });
    }
    // The rejected account got no driver row.
    expect(await second.query(api.freightFate.getMyDriver, {})).toBeNull();

    // A different name still works.
    const ok = await second.mutation(api.freightFate.provisionDriver, {
      displayName: "Orinks Junior",
      visibility: "private",
      now,
    });
    expect(typeof ok.token).toBe("string");

    // Renaming onto the taken name is rejected too...
    await expect(
      second.mutation(api.freightFate.provisionDriver, {
        displayName: "ORINKS",
        visibility: "private",
        now: now + 1,
      }),
    ).rejects.toMatchObject({ data: { code: "name_taken" } });

    // ...but re-saving your own unchanged name (any case) never is, so a
    // pre-existing duplicate cannot lock its owner out of the settings form.
    const resave = await second.mutation(api.freightFate.provisionDriver, {
      displayName: "orinks junior",
      visibility: "unlisted",
      now: now + 2,
    });
    expect(resave.rotated).toBe(false);
    const mine = await second.query(api.freightFate.getMyDriver, {});
    expect(mine!.visibility).toBe("unlisted");
  });

  test("rate limits presence writes per driver", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const driverTokenHash = await sha256Hex(token!);

    for (let i = 0; i < PRESENCE_WRITE_LIMIT; i += 1) {
      const result = await t.mutation(api.freightFate.updatePresence, {
        driverId,
        driverTokenHash,
        activity: `hauling ${i}`,
        detail: "I-70 westbound",
        now,
      });
      expect(result.ok).toBe(true);
    }

    const limited = await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash,
      activity: "one too many",
      detail: "I-70 westbound",
      now,
    });
    expect(limited).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  test("rate limits event writes even when the token is wrong", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    for (let i = 0; i < DRIVER_EVENT_WRITE_LIMIT; i += 1) {
      const result = await t.mutation(api.freightFate.recordDriverEvent, {
        driverId,
        driverTokenHash: await sha256Hex(`ffd_wrong_${i}`),
        eventId: `wrong-${i}`,
        eventType: "delivery",
        summary: "Forged delivery",
        occurredAt: now,
        now,
      });
      expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
    }

    const limited = await t.mutation(api.freightFate.recordDriverEvent, {
      driverId,
      driverTokenHash: await sha256Hex("ffd_wrong_overflow"),
      eventId: "wrong-overflow",
      eventType: "delivery",
      summary: "Forged delivery",
      occurredAt: now,
      now,
    });
    expect(limited).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  test("clamps event timestamps and prunes older journal entries", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;

    const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const driverTokenHash = await sha256Hex(token!);

    const future = await t.mutation(api.freightFate.recordDriverEvent, {
      driverId,
      driverTokenHash,
      eventId: "future-delivery",
      eventType: "delivery",
      summary: "Future delivery",
      occurredAt: now + DRIVER_EVENT_CLOCK_SKEW_MS + 1,
      now,
    });
    expect(future.ok).toBe(true);

    for (let i = 0; i < MAX_DRIVER_EVENTS; i += 1) {
      const result = await t.mutation(api.freightFate.recordDriverEvent, {
        driverId,
        driverTokenHash,
        eventId: `delivery-${i}`,
        eventType: "delivery",
        summary: `Delivery ${i}`,
        occurredAt: now + i,
        now: now + i + 1,
      });
      expect(result.ok).toBe(true);
    }

    const profile = await t.query(api.freightFate.getDriverProfile, { driverId, limit: MAX_DRIVER_EVENTS });
    expect(profile).not.toBeNull();
    expect(profile!.events).toHaveLength(MAX_DRIVER_EVENTS);
    expect(profile!.events.find((event) => event.eventId === "future-delivery")).toBeUndefined();

    const stored = await t.run(async (ctx) => {
      return ctx.db
        .query("freightFateDriverEvents")
        .withIndex("by_driver", (q) => q.eq("driverId", driverId))
        .collect();
    });
    expect(stored).toHaveLength(MAX_DRIVER_EVENTS);
    expect(Math.max(...stored.map((event) => event.occurredAt))).toBeLessThanOrEqual(now + DRIVER_EVENT_CLOCK_SKEW_MS);
  });

  test("private profiles are not publicly readable but unlisted profiles are link-visible", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const other = t.withIdentity({ subject: OTHER });
    const now = Date.now();

    const privateDriver = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Private Hauler",
      visibility: "private",
      now,
    });
    expect(await t.query(api.freightFate.getDriverProfile, { driverId: privateDriver.driverId })).toBeNull();

    const unlistedDriver = await other.mutation(api.freightFate.provisionDriver, {
      displayName: "Link Hauler",
      visibility: "unlisted",
      now,
    });
    const posted = await t.mutation(api.freightFate.recordDriverEvent, {
      driverId: unlistedDriver.driverId,
      driverTokenHash: await sha256Hex(unlistedDriver.token!),
      eventId: "delivery",
      eventType: "delivery",
      summary: "Delivered canned goods to Chicago",
      occurredAt: now,
      now,
    });
    expect(posted.ok).toBe(true);

    const profile = await t.query(api.freightFate.getDriverProfile, { driverId: unlistedDriver.driverId });
    expect(profile?.driver.displayName).toBe("Link Hauler");
    expect(profile?.events).toHaveLength(1);
  });

  test("re-provision edits the profile in place; token only changes when rotated", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    // Saving a profile edit without rotating keeps the same id and token.
    const edit = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      now: now + 1,
    });
    expect(edit.driverId).toBe(first.driverId);
    expect(edit.token).toBeNull();
    expect(edit.rotated).toBe(false);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine!.displayName).toBe("Night Hauler");
    expect(mine!.visibility).toBe("private");

    const stillOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token!),
      activity: "a",
      detail: "b",
      now: now + 2,
    });
    expect(stillOk.ok).toBe(true);

    // Rotating mints a new token and invalidates the old one.
    const rotated = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      rotateToken: true,
      now: now + 3,
    });
    expect(rotated.rotated).toBe(true);
    expect(typeof rotated.token).toBe("string");
    expect(rotated.token).not.toBe(first.token);

    const oldFails = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token!),
      activity: "a",
      detail: "b",
      now: now + 4,
    });
    expect(oldFails.ok).toBe(false);

    const newOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(rotated.token!),
      activity: "a",
      detail: "b",
      now: now + 5,
    });
    expect(newOk.ok).toBe(true);
  });
});

describe("driver name moderation", () => {
  test("provisionDriver rejects names that fail screening, with the reason the client maps", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    for (const [displayName, reason] of [
      ["Hitler", "blocked"],
      ["h1tler fan", "blocked"],
      ["!!!###", "needs_letters"],
    ] as const) {
      let thrown: unknown;
      try {
        await as.mutation(api.freightFate.provisionDriver, { displayName, visibility: "public", now });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, displayName).toBeInstanceOf(ConvexError);
      expect((thrown as ConvexError<{ code: string; reason: string }>).data).toEqual({
        code: "name_rejected",
        reason,
      });
    }

    // Nothing was stored by the rejected attempts.
    expect(await as.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("public read paths mask a stored offensive name instead of showing it", async () => {
    const t = setup();
    const now = Date.now();

    // Seed a row that predates write-time screening.
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "hitler-a1b2c3d4",
        displayName: "Hitler",
        visibility: "public",
        authSubject: OTHER,
        driverTokenHash: "irrelevant",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("freightFatePresence", {
        driverId: "hitler-a1b2c3d4",
        activity: "hauling",
        detail: "I-70",
        updatedAt: now,
      });
    });

    const board = await t.query(api.freightFate.getPresenceBoard, { now });
    expect(board.drivers).toHaveLength(1);
    expect(board.drivers[0].displayName).toBe("Driver c3d4");

    const profile = await t.query(api.freightFate.getDriverProfile, { driverId: "hitler-a1b2c3d4" });
    expect(profile!.driver.displayName).toBe("Driver c3d4");
  });

  test("forceRename resets the name, flags needsRename, and a screened rename clears it", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId } = await as.mutation(api.freightFate.provisionDriver, {
      // Clean at write time; imagine moderation later judges it abusive.
      displayName: "Sneaky Impersonator",
      visibility: "public",
      now,
    });

    const renamed = await t.mutation(internal.freightFateAdmin.forceRename, { driverId });
    expect(renamed.driverId).toBe(driverId); // id untouched without regenerateId
    expect(renamed.displayName).toBe(`Driver ${driverId.slice(-4)}`);

    const flagged = await as.query(api.freightFate.getMyDriver, {});
    expect(flagged!.needsRename).toBe(true);
    expect(flagged!.displayName).toBe(renamed.displayName);

    // The player saves a compliant name; the flag clears.
    await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Reformed Hauler",
      visibility: "public",
      now: now + 1,
    });
    const cleared = await as.query(api.freightFate.getMyDriver, {});
    expect(cleared!.needsRename).toBe(false);
    expect(cleared!.displayName).toBe("Reformed Hauler");
  });

  test("forceRename with regenerateId rewrites the slug and cascades to journal events", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const driverTokenHash = await sha256Hex(token!);

    await t.mutation(api.freightFate.recordDriverEvent, {
      driverId,
      driverTokenHash,
      eventId: "evt-1",
      eventType: "delivery",
      summary: "Delivered reefer to Denver",
      occurredAt: now,
      now,
    });
    await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash,
      activity: "hauling",
      detail: "I-70",
      now,
    });

    const renamed = await t.mutation(internal.freightFateAdmin.forceRename, {
      driverId,
      regenerateId: true,
    });
    expect(renamed.regeneratedId).toBe(true);
    expect(renamed.driverId).not.toBe(driverId);
    expect(normalizeDriverId(renamed.driverId)).toBe(renamed.driverId); // still canonical

    // Journal history followed the driver to the new id...
    const profile = await t.query(api.freightFate.getDriverProfile, { driverId: renamed.driverId });
    expect(profile!.events).toHaveLength(1);
    expect(await t.query(api.freightFate.getDriverProfile, { driverId })).toBeNull();

    // ...the stale presence row is gone, and the game's next heartbeat under
    // the old id no-ops until the player pastes the new Driver ID.
    const board = await t.query(api.freightFate.getPresenceBoard, { now });
    expect(board.drivers).toHaveLength(0);
    const stale = await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash,
      activity: "hauling",
      detail: "I-70",
      now: now + 1,
    });
    expect(stale).toMatchObject({ ok: false, reason: "driver_not_found" });
  });
});
