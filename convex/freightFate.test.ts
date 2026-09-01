/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import invariants from "../data/freight-fate-profile-invariants.json";
import {
  DRIVER_EVENT_CLOCK_SKEW_MS,
  DRIVER_EVENT_WRITE_LIMIT,
  MAX_DRIVER_EVENTS,
  PRESENCE_WRITE_LIMIT,
  SHARING_CONSENT_VERSION,
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

// provisionDriver does not mint tokens: a computer gets one only by
// activating itself from the game. Tests that need a working token connect
// one the way a player does -- start, confirm the code while signed in,
// redeem. Redeeming is what mints, so this also keeps the tests below honest
// about where a token can come from.
async function connectComputer(
  t: ReturnType<typeof setup>,
  subject: string,
  label: string,
  now: number,
) {
  const started = await t.mutation(api.freightFateActivation.startActivation, {
    clientKey: `${subject}:${label}`,
    now,
  });
  await t.withIdentity({ subject }).mutation(api.freightFateActivation.claimActivation, {
    userCode: started.userCode,
    label,
    now,
  });
  const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
    deviceCodeHash: await sha256Hex(started.deviceCode),
    now,
  });
  return redeemed!.token;
}

/** A driver plus one connected computer. */
async function provisionWithComputer(
  t: ReturnType<typeof setup>,
  subject: string,
  args: {
    displayName: string;
    visibility: "public" | "private" | "unlisted";
    expandedSharingConsent?: boolean;
    now: number;
  },
  label = "My computer",
) {
  const { driverId } = await t
    .withIdentity({ subject })
    .mutation(api.freightFate.provisionDriver, args);
  return { driverId, token: await connectComputer(t, subject, label, args.now) };
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

  test("provisions a driver keyed to the account, with no computer connected yet", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const result = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "  Rig   Hauler  ",
      visibility: "public",
      now,
    });

    expect(result.rotated).toBe(false);
    // Nothing is minted here. A token issued at sign-up could not be handed
    // to the computer that needs it, so it would only ever be a phantom row
    // in the player's computer list -- "My computer, not used yet," held by
    // no computer at all.
    expect(result).not.toHaveProperty("token");
    expect(
      await t.run(async (ctx) => await ctx.db.query("freightFateDeviceTokens").collect()),
    ).toHaveLength(0);
    expect((await as.query(api.freightFate.getMyComputers, {}))!.computers).toHaveLength(0);
    // The public slug is already canonical, so the game echoing it back and the
    // REST route re-normalizing it yields the same id.
    expect(normalizeDriverId(result.driverId)).toBe(result.driverId);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine).not.toBeNull();
    expect(mine!.driverId).toBe(result.driverId);
    expect(mine!.displayName).toBe("Rig Hauler"); // whitespace normalized
    expect(mine!.visibility).toBe("private");
    expect(mine!.sharingEnabled).toBe(false);
    expect(mine!.hasToken).toBe(false);
    expect(mine).not.toHaveProperty("token"); // the plaintext token never leaks

    // A different account cannot see this driver.
    const other = t.withIdentity({ subject: OTHER });
    expect(await other.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("issued token authenticates the game's presence path; wrong token is rejected", async () => {
    const t = setup();
    const now = Date.now();

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });

    // The game sends driverId + Bearer token; the REST route hashes the token
    // with hashFreightFateToken and calls updatePresence. Simulate that path.
    const ok = await t.mutation(api.freightFate.updatePresence, {
      driverId: normalizeDriverId(driverId),
      driverTokenHash: await sha256Hex(token),
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

  test("authenticated writes stamp the reporting game build on the driver row", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const driverTokenHash = await sha256Hex(token);
    const driverRow = async () =>
      (await t.run(async (ctx) =>
        ctx.db
          .query("freightFateDrivers")
          .withIndex("by_driver_id", (q) => q.eq("driverId", driverId))
          .unique(),
      ))!;

    // A heartbeat without a version (pre-stamp game build) leaves no mark.
    await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "hauling", detail: "", now,
    });
    expect((await driverRow()).lastClientVersion).toBeUndefined();

    // A wrong token must not stamp: an unauthenticated caller cannot plant
    // a build identity on someone else's driver row.
    await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash: await sha256Hex("ffd_not_the_real_token_value_here"),
      activity: "hauling", detail: "", clientVersion: "nightly-20260712", now,
    });
    expect((await driverRow()).lastClientVersion).toBeUndefined();

    // First versioned heartbeat records the build and when it appeared.
    await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "hauling", detail: "",
      clientVersion: "nightly-20260711", now: now + 1,
    });
    let row = await driverRow();
    expect(row.lastClientVersion).toBe("nightly-20260711");
    expect(row.lastClientVersionAt).toBe(now + 1);

    // Steady heartbeats on the same build do not touch the row again, so
    // lastClientVersionAt stays "first seen", not "last heartbeat".
    await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "hauling", detail: "",
      clientVersion: "nightly-20260711", now: now + 2,
    });
    row = await driverRow();
    expect(row.lastClientVersionAt).toBe(now + 1);

    // Switching builds (say, a source checkout) re-stamps both fields.
    await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "hauling", detail: "",
      clientVersion: "source-1.9.0.dev0", now: now + 3,
    });
    row = await driverRow();
    expect(row.lastClientVersion).toBe("source-1.9.0.dev0");
    expect(row.lastClientVersionAt).toBe(now + 3);

    // The moderation report lists the stamped build per driver.
    const report = await t.query(internal.freightFateAdmin.listClientVersions, {});
    expect(report).toContainEqual({
      driverId,
      displayName: "Rig Hauler",
      clientVersion: "source-1.9.0.dev0",
      clientVersionAt: now + 3,
      integrityFlag: null,
      integrityFlaggedAt: null,
    });
  });

  test("an integrity-flagged driver is hidden from every public surface until cleared", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });
    const driverTokenHash = await sha256Hex(token);

    // On the board, in the feed, and profile visible while unflagged.
    await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "hauling", detail: "", now,
    });
    await t.mutation(api.freightFate.publishCareerMilestone, {
      driverId, driverTokenHash, eventId: "career-1", milestoneType: "first_delivery",
      occurredAt: now, now,
    });
    expect((await t.query(api.freightFate.getPresenceBoard, { now })).drivers)
      .toHaveLength(1);
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates).toHaveLength(1);
    expect(await t.query(api.freightFate.getDriverProfile, { driverId, now })).not.toBeNull();

    // The sticky verdict holds the whole public face — board, feed, and
    // profile — even though the driver's sharing setting is still public.
    // Sharing consent says "may show me"; the flag says "not until reviewed".
    await t.mutation(internal.freightFateAdmin.setIntegrityFlag, {
      driverId, flag: "impossible_money",
    });
    expect((await t.query(api.freightFate.getPresenceBoard, { now })).drivers)
      .toHaveLength(0);
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates).toHaveLength(0);
    expect(await t.query(api.freightFate.getDriverProfile, { driverId, now })).toBeNull();

    // The driver's own game keeps working: only the public face is held.
    const heartbeat = await t.mutation(api.freightFate.updatePresence, {
      driverId, driverTokenHash, activity: "still hauling", detail: "", now: now + 1,
    });
    expect(heartbeat.ok).toBe(true);

    // Clearing after review restores the public face.
    await t.mutation(internal.freightFateAdmin.setIntegrityFlag, { driverId, flag: null });
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 1 })).drivers)
      .toHaveLength(1);
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates).toHaveLength(1);
    expect(await t.query(api.freightFate.getDriverProfile, { driverId, now: now + 1 }))
      .not.toBeNull();
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
    expect(ok.driverId).toBeTruthy();
    expect(ok.rotated).toBe(false);

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
    expect(mine!.visibility).toBe("private");
    expect(mine!.sharingEnabled).toBe(false);
  });

  test("rate limits presence writes per driver", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const driverTokenHash = await sha256Hex(token);

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

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });
    const driverTokenHash = await sha256Hex(token);

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

  test("provisioning preserves consented unlisted visibility", async () => {
    const t = setup();
    const other = t.withIdentity({ subject: OTHER });
    const now = Date.now();
    const unlisted = await provisionWithComputer(t, OTHER, {
      displayName: "Link Hauler",
      visibility: "unlisted",
      expandedSharingConsent: true,
      now,
    });
    const mine = await other.query(api.freightFate.getMyDriver, {});
    expect(mine).toMatchObject({
      driverId: unlisted.driverId,
      visibility: "unlisted",
      sharingEnabled: true,
    });
  });

  test("unlisted profiles accept journal events and remain link-visible but unlisted", async () => {
    const t = setup();
    const now = Date.now();
    const unlistedDriver = await provisionWithComputer(t, OTHER, {
      displayName: "Link Hauler",
      visibility: "unlisted",
      expandedSharingConsent: true,
      now,
    });
    const auth = {
      driverId: unlistedDriver.driverId,
      driverTokenHash: await sha256Hex(unlistedDriver.token),
    };
    const posted = await t.mutation(api.freightFate.recordDriverEvent, {
      ...auth,
      eventId: "delivery",
      eventType: "delivery",
      summary: "Delivered canned goods to Chicago",
      occurredAt: now,
      now,
    });
    expect(posted.ok).toBe(true);
    await expect(t.mutation(api.freightFate.publishDeliveryCompleted, {
      ...auth,
      eventId: "structured-delivery",
      occurredAt: now,
      now,
      payload: {
        version: 1,
        cargo: "canned goods",
        weightPounds: 24_000,
        origin: "Detroit, Michigan",
        destination: "Chicago, Illinois",
        distanceMiles: 284,
        onTime: true,
      },
    })).resolves.toMatchObject({ ok: true, duplicate: false });

    const profile = await t.query(api.freightFate.getDriverProfile, { driverId: unlistedDriver.driverId });
    expect(profile?.driver.displayName).toBe("Link Hauler");
    expect(profile?.events).toHaveLength(2);

    await expect(t.mutation(api.freightFate.updatePresence, {
      ...auth,
      activity: "Hauling",
      detail: "Link-only driver",
      now,
    })).resolves.toMatchObject({ ok: true });
    expect((await t.query(api.freightFate.getPresenceBoard, { now })).drivers)
      .toEqual([]);
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates)
      .toEqual([]);
  });

  test("consented private profiles reject journal events and remain hidden from links and listings", async () => {
    const t = setup();
    const now = Date.now();
    const privateDriver = await provisionWithComputer(t, SUBJECT, {
      displayName: "Private Hauler",
      visibility: "private",
      expandedSharingConsent: true,
      now,
    });
    const auth = {
      driverId: privateDriver.driverId,
      driverTokenHash: await sha256Hex(privateDriver.token),
    };

    await expect(t.mutation(api.freightFate.recordDriverEvent, {
      ...auth,
      eventId: "private-delivery",
      eventType: "delivery",
      summary: "Private delivery",
      occurredAt: now,
      now,
    })).resolves.toMatchObject({ ok: false, reason: "sharing_not_enabled" });
    await expect(t.mutation(api.freightFate.publishDeliveryCompleted, {
      ...auth,
      eventId: "private-structured-delivery",
      occurredAt: now,
      now,
      payload: {
        version: 1,
        cargo: "private cargo",
        weightPounds: 12_000,
        origin: "Detroit, Michigan",
        destination: "Chicago, Illinois",
        distanceMiles: 284,
        onTime: true,
      },
    })).resolves.toMatchObject({ ok: false, reason: "sharing_not_enabled" });
    expect(await t.query(api.freightFate.getDriverProfile, {
      driverId: privateDriver.driverId,
    })).toBeNull();
    await expect(t.mutation(api.freightFate.updatePresence, {
      ...auth,
      activity: "Hauling",
      detail: "Private driver",
      now,
    })).resolves.toMatchObject({ ok: true });
    expect((await t.query(api.freightFate.getPresenceBoard, { now })).drivers)
      .toEqual([]);
  });

  test("re-provision edits the profile in place; only a rotate touches tokens", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    // Saving a profile edit without rotating keeps the same id, and leaves
    // the connected computer alone.
    const edit = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      now: now + 1,
    });
    expect(edit.driverId).toBe(first.driverId);
    expect(edit.rotated).toBe(false);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine!.displayName).toBe("Night Hauler");
    expect(mine!.visibility).toBe("private");

    const stillOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token),
      activity: "a",
      detail: "b",
      now: now + 2,
    });
    expect(stillOk.ok).toBe(true);

    // Rotating kills every token and issues none: the panic switch leaves the
    // driver with no connected computers, each of which must activate again.
    const rotated = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      rotateToken: true,
      now: now + 3,
    });
    expect(rotated.rotated).toBe(true);
    expect(rotated).not.toHaveProperty("token");
    expect((await as.query(api.freightFate.getMyComputers, {}))!.computers).toHaveLength(0);
    expect((await as.query(api.freightFate.getMyDriver, {}))!.hasToken).toBe(false);

    const oldFails = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token),
      activity: "a",
      detail: "b",
      now: now + 4,
    });
    expect(oldFails.ok).toBe(false);

    // Activating again is how a computer gets back in -- and that token works.
    const reconnected = await connectComputer(t, SUBJECT, "Studio desktop", now + 5);
    expect(reconnected).not.toBe(first.token);
    const newOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(reconnected),
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
        sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now,
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

    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });
    const driverTokenHash = await sha256Hex(token);

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

describe("expanded sharing", () => {
  test("public event projections replace poisoned client prose and omit unknown events", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "safe-journal-driver", displayName: "Safe Journal", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      for (const [index, event] of [
        {
          eventId: "delivery-safe", eventType: "delivery_completed",
          payloadVersion: 1, payload: {
            version: 1, cargo: "CARGO-PRIVATE-7241", weightPounds: 42_000,
            origin: "LOCATION-PRIVATE-4921", destination: "DESTINATION-PRIVATE-1278",
            customer: "CUSTOMER-PRIVATE-8173", value: "VALUE-PRIVATE-9127",
            fatigue: "FATIGUE-PRIVATE-2819", hos: "HOS-PRIVATE-3912",
            dispatcherStanding: "DISPATCHER-PRIVATE-4812", distanceMiles: 875,
            onTime: true,
          },
        },
        {
          eventId: "achievement-safe", eventType: "achievement_earned",
          payloadVersion: 1, payload: {
            achievementKey: "clean_delivery", name: "POISONED ACHIEVEMENT NAME",
            description: "POISONED ACHIEVEMENT DESCRIPTION",
          },
        },
        {
          eventId: "achievement-unknown", eventType: "achievement_earned",
          payloadVersion: 1, payload: { achievementKey: "unknown_poisoned_key" },
        },
        { eventId: "legacy-delivery", eventType: "delivery" },
        { eventId: "unknown-event", eventType: "private_status" },
      ].entries()) {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId: "safe-journal-driver", ...event,
          summary: "POISONED SUMMARY CASH-PRIVATE-9182 CREDIT-PRIVATE-3817",
          occurredAt: now - index, createdAt: now,
        });
      }
    });

    const profile = await t.query(api.freightFate.getDriverProfile, {
      driverId: "safe-journal-driver", limit: 20,
    });
    const feed = await t.query(api.freightFate.getPublicUpdates, { limit: 20 });
    for (const result of [profile?.events, feed.updates]) {
      expect(result?.map((event) => [event.eventType, event.summary])).toEqual([
        ["delivery_completed", "Completed a delivery covering 875 miles on time."],
        ["achievement_earned", "Earned Pretty as a Billboard."],
        ["delivery_completed", "Completed a delivery."],
      ]);
      const json = JSON.stringify(result);
      for (const sentinel of [
        "POISONED", "CASH-PRIVATE-9182", "CREDIT-PRIVATE-3817",
        "LOCATION-PRIVATE-4921", "CARGO-PRIVATE-7241", "CUSTOMER-PRIVATE-8173",
        "VALUE-PRIVATE-9127", "DESTINATION-PRIVATE-1278", "FATIGUE-PRIVATE-2819",
        "HOS-PRIVATE-3912", "DISPATCHER-PRIVATE-4812", "unknown_poisoned_key",
      ]) expect(json).not.toContain(sentinel);
      expect(result?.every((event) => !("payload" in event))).toBe(true);
    }

    const firstProfilePage = await t.query(api.freightFate.getDriverProfile, {
      driverId: "safe-journal-driver", limit: 2,
    });
    expect(firstProfilePage?.events).toHaveLength(2);
    expect(firstProfilePage?.nextBefore).not.toBeNull();
    const secondProfilePage = await t.query(api.freightFate.getDriverProfile, {
      driverId: "safe-journal-driver", limit: 2, before: firstProfilePage!.nextBefore!,
    });
    expect(secondProfilePage?.events.map((event) => event.summary)).toEqual([
      "Completed a delivery.",
    ]);

    const firstFeedPage = await t.query(api.freightFate.getPublicUpdates, { limit: 2 });
    expect(firstFeedPage.updates).toHaveLength(2);
    const secondFeedPage = await t.query(api.freightFate.getPublicUpdates, {
      limit: 2, before: firstFeedPage.nextBefore!,
    });
    expect(secondFeedPage.updates.map((event) => event.summary)).toEqual([
      "Completed a delivery.",
    ]);
  });

  test("paginates every canonical account achievement including imports without dates", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "complete-badge-driver", displayName: "Complete Badge", visibility: "unlisted",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "complete-badge-driver", achievementKey: "clean_delivery",
        name: "POISONED", description: "POISONED", earnedAt: now, createdAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "complete-badge-driver", achievementKey: "first_delivery",
        importSource: "verified_save", importedAt: now, createdAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "complete-badge-driver", achievementKey: "coast_to_coast",
        importSource: "verified_save", importedAt: now - 1, createdAt: now,
      });
    });

    const first = await t.query(api.freightFate.getDriverProfile, {
      driverId: "complete-badge-driver", achievementLimit: 2,
    });
    expect(first?.achievementCount).toBe(3);
    expect(first?.recentAchievements.map((item) => item.achievementKey)).toEqual(["clean_delivery"]);
    expect(first?.achievements).toEqual([
      expect.objectContaining({ achievementKey: "clean_delivery", label: "Pretty as a Billboard", earnedAt: now }),
      expect.objectContaining({ achievementKey: "first_delivery", label: "Signed, Sealed, Hauled" }),
    ]);
    expect(first?.achievements[1]).not.toHaveProperty("earnedAt");
    expect(first?.nextAchievementBefore).not.toBeNull();

    const second = await t.query(api.freightFate.getDriverProfile, {
      driverId: "complete-badge-driver", achievementLimit: 2,
      achievementBefore: first!.nextAchievementBefore!,
    });
    expect(second?.achievements).toEqual([
      expect.objectContaining({ achievementKey: "coast_to_coast", label: "Coast-to-Coast Hauler" }),
    ]);
    expect(second?.nextAchievementBefore).toBeNull();
    expect([...first!.achievements, ...second!.achievements]).toHaveLength(first!.achievementCount);
  });

  test("legacy consent cannot publish or expose expanded profile data", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;
    const { driverId, token } = await provisionWithComputer(t, SUBJECT, {
      displayName: "Legacy Hauler", visibility: "public", now,
    });
    await t.run((ctx) => ctx.db.insert("freightFateProfileSnapshots", {
      driverId, version: 1, level: 3, careerTitle: "Regional driver",
      lastSavedCity: "Chicago, Illinois", deliveries: 4, milesDriven: 500,
      reputation: 60, capturedAt: now, updatedAt: now,
    }));
    expect(await t.query(api.freightFate.getDriverProfile, { driverId })).toBeNull();
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates).toEqual([]);
  });

  test("renewed public sharing exposes allowlisted snapshot and feed while private does not", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;
    const provisioned = await provisionWithComputer(t, SUBJECT, {
      displayName: "Journal Hauler", visibility: "public", expandedSharingConsent: true, now,
    });
    const auth = { driverId: provisioned.driverId, driverTokenHash: await sha256Hex(provisioned.token) };
    await t.run((ctx) => ctx.db.insert("freightFateProfileSnapshots", {
      driverId: auth.driverId, version: 1, level: 7, careerTitle: "Long-haul driver",
      lastSavedCity: "Denver, Colorado", deliveries: 22, milesDriven: 8123.4,
      reputation: 91, truckName: "heavy hauler", capturedAt: now, updatedAt: now,
      sourceSaveName: "Journal Hauler", sourceRevision: 1, validatorVersion: 1,
    }));
    expect(await t.mutation(api.freightFate.publishDeliveryCompleted, {
      ...auth, eventId: "delivery-22", occurredAt: now, now,
      payload: { version: 1, cargo: "steel coils", weightPounds: 42000, origin: "Chicago, Illinois", destination: "Denver, Colorado", distanceMiles: 1002, onTime: true },
    })).toMatchObject({ ok: true, duplicate: false });
    expect(await t.mutation(api.freightFate.publishDeliveryCompleted, {
      ...auth, eventId: "delivery-22", occurredAt: now, now: now + 1,
      payload: { version: 1, cargo: "steel coils", weightPounds: 42000, origin: "Chicago, Illinois", destination: "Denver, Colorado", distanceMiles: 1002, onTime: true },
    })).toMatchObject({ ok: true, duplicate: true });
    expect(await t.mutation(api.freightFate.publishDeliveryCompleted, {
      ...auth, eventId: "delivery-21", occurredAt: now - 1_000, now,
      payload: { version: 1, cargo: "produce", weightPounds: 30000, origin: "Omaha, Nebraska", destination: "Chicago, Illinois", distanceMiles: 470, onTime: true },
    })).toMatchObject({ ok: true, duplicate: false });
    const profile = await t.query(api.freightFate.getDriverProfile, { driverId: provisioned.driverId });
    expect(profile?.snapshot).toMatchObject({ level: 7, deliveries: 22 });
    expect(profile?.snapshot).not.toHaveProperty("lastSavedCity");
    expect(profile?.snapshot).not.toHaveProperty("future");
    const firstPage = await t.query(api.freightFate.getPublicUpdates, { limit: 1 });
    expect(firstPage.updates.map((event) => event.eventId)).toEqual(["delivery-22"]);
    expect(firstPage.nextBefore).toEqual({ occurredAt: now, eventId: "delivery-22" });
    const secondPage = await t.query(api.freightFate.getPublicUpdates, { limit: 1, before: firstPage.nextBefore! });
    expect(secondPage.updates.map((event) => event.eventId)).toEqual(["delivery-21"]);
    const profilePage = await t.query(api.freightFate.getDriverProfile, { driverId: provisioned.driverId, limit: 1 });
    expect(profilePage?.events.map((event) => event.eventId)).toEqual(["delivery-22"]);
    expect(profilePage?.nextBefore).toEqual({ occurredAt: now, eventId: "delivery-22" });

    await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Journal Hauler", visibility: "public", expandedSharingConsent: false, now: now + 2,
    });
    expect(await t.query(api.freightFate.getDriverProfile, { driverId: provisioned.driverId })).toBeNull();
    expect((await t.query(api.freightFate.getPublicUpdates, {})).updates).toEqual([]);
  });

  test("driver token turns canonical profile sharing off and clears presence", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;
    const provisioned = await provisionWithComputer(t, SUBJECT, {
      displayName: "Privacy Hauler", visibility: "public", expandedSharingConsent: true, now,
    });
    const driverTokenHash = await sha256Hex(provisioned.token);
    await t.mutation(api.freightFate.updatePresence, {
      driverId: provisioned.driverId, driverTokenHash,
      activity: "Driving", detail: "Broad activity", now,
    });
    expect((await t.query(api.freightFate.getPresenceBoard, { now })).drivers).toHaveLength(1);
    expect(await t.mutation(api.freightFate.setProfileSharing, {
      driverId: provisioned.driverId, driverTokenHash, enabled: false, now: now + 1,
    })).toEqual({ ok: true, enabled: false });
    expect(await t.query(api.freightFate.getDriverProfile, { driverId: provisioned.driverId })).toBeNull();
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 1 })).drivers).toEqual([]);
  });

  test("a parked truck that keeps beating ages off the public surfaces", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;
    const minute = 60_000;
    const provisioned = await provisionWithComputer(t, SUBJECT, {
      displayName: "Parked Hauler", visibility: "public", expandedSharingConsent: true, now,
    });
    const driverId = provisioned.driverId;
    const driverTokenHash = await sha256Hex(provisioned.token);
    const beat = (at: number, detail = "parcel freight, 65% there") =>
      t.mutation(api.freightFate.updatePresence, {
        driverId, driverTokenHash,
        activity: "Stopped: Richmond to Lynchburg", detail, now: at,
      });

    // Heartbeats keep the row alive but the strings never change: still a
    // live driver until the idle window runs out.
    await beat(now);
    await beat(now + 29 * minute);
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 29 * minute })).drivers)
      .toHaveLength(1);

    // Past the window the game still beats and the row stays fresh (the TTL
    // never expires it), but board and profile both stop showing it.
    await beat(now + 31 * minute);
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 31 * minute })).drivers)
      .toEqual([]);
    const profile = await t.query(api.freightFate.getDriverProfile, {
      driverId, now: now + 31 * minute,
    });
    expect(profile).not.toBeNull();
    expect(profile!.presence).toBeNull();

    // Any real change — the truck rolling again — re-lists immediately.
    await beat(now + 32 * minute, "parcel freight, 70% there");
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 32 * minute })).drivers)
      .toHaveLength(1);
  });

  test("pre-filter presence rows get a baseline stamp, not an instant drop", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = 1_800_000_000_000;
    const minute = 60_000;
    const provisioned = await provisionWithComputer(t, SUBJECT, {
      displayName: "Legacy Hauler", visibility: "public", expandedSharingConsent: true, now,
    });
    const driverId = provisioned.driverId;
    const driverTokenHash = await sha256Hex(provisioned.token);
    // A row written by the deployment before changedAt existed — the driver
    // may already have been parked for a day when the filter ships.
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFatePresence", {
        driverId, activity: "Stopped: somewhere", detail: "for a day", updatedAt: now,
      });
    });
    const beat = (at: number) =>
      t.mutation(api.freightFate.updatePresence, {
        driverId, driverTokenHash,
        activity: "Stopped: somewhere", detail: "for a day", now: at,
      });

    // The first post-deploy beat baselines the idle clock instead of judging
    // the row idle on the spot...
    await beat(now + 2 * minute);
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 2 * minute })).drivers)
      .toHaveLength(1);

    // ...and one unchanged idle window after that baseline, the driver ages
    // off like any other parked truck.
    await beat(now + 33 * minute);
    expect((await t.query(api.freightFate.getPresenceBoard, { now: now + 33 * minute })).drivers)
      .toEqual([]);
  });

  test("rejects achievement event keys outside the exported catalog", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const provisioned = await provisionWithComputer(t, "achievement-key-user", {
      displayName: "Catalog Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });
    const auth = {
      driverId: provisioned.driverId,
      driverTokenHash: await sha256Hex(provisioned.token),
    };

    await expect(t.mutation(api.freightFate.publishAchievementEarned, {
      ...auth,
      eventId: "achievement-invented",
      achievementKey: "invented_achievement",
      name: "Invented",
      description: "Not in the Freight Fate catalog.",
      earnedAt: now,
      now,
    })).resolves.toMatchObject({ ok: false, reason: "invalid_achievement" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("freightFateAchievements").collect()).toEqual([]);
      expect(await ctx.db.query("freightFateDriverEvents").collect()).toEqual([]);
    });
  });

  test("counts and returns only catalog achievements from a bounded account set", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "bounded-badges",
        displayName: "Bounded Badges",
        visibility: "public",
        driverTokenHash: "hash",
        sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < invariants.achievementIds.length + 25; index += 1) {
        await ctx.db.insert("freightFateAchievements", {
          driverId: "bounded-badges",
          achievementKey: `invalid-${index.toString().padStart(3, "0")}`,
          name: "Invalid",
          description: "Historical invalid row",
          earnedAt: now + index,
          createdAt: now,
        });
      }
      await ctx.db.insert("freightFateAchievements", {
        driverId: "bounded-badges",
        achievementKey: "clean_delivery",
        name: "Clean Delivery",
        description: "Delivered without damage.",
        earnedAt: now - 1,
        createdAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "bounded-badges",
        achievementKey: "first_delivery",
        name: "First Delivery",
        description: "Completed a first delivery.",
        earnedAt: now - 2,
        createdAt: now,
      });
    });

    const profile = await t.query(api.freightFate.getDriverProfile, {
      driverId: "bounded-badges",
      limit: 20,
    });
    expect(profile?.achievementCount).toBe(2);
    expect(profile?.achievements.map((badge) => badge.achievementKey))
      .toEqual(["clean_delivery", "first_delivery"]);
    expect(profile?.achievements.every((badge) =>
      invariants.achievementIds.includes(badge.achievementKey))).toBe(true);
  });

  test("cursor pagination has no gaps for equal timestamps", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "cursor-driver", displayName: "Cursor Driver", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      for (const eventId of ["event-c", "event-b", "event-a"]) {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId: "cursor-driver", eventId, eventType: "delivery_completed",
          summary: eventId, occurredAt: now, createdAt: now,
        });
      }
    });
    const seen: string[] = [];
    let before: { occurredAt: number; eventId: string } | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = await t.query(api.freightFate.getPublicUpdates, { limit: 1, ...(before ? { before } : {}) });
      seen.push(...result.updates.map((event) => event.eventId));
      before = result.nextBefore ?? undefined;
    }
    expect(seen).toEqual(["event-c", "event-b", "event-a"]);
    expect(new Set(seen).size).toBe(3);
  });

  test("hidden rows cannot truncate an older public update", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "hidden-driver", displayName: "Hidden Driver", visibility: "private",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("freightFateDrivers", {
        driverId: "public-driver", displayName: "Public Driver", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      for (let index = 0; index < 201; index += 1) {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId: "hidden-driver", eventId: `hidden-${index}`, eventType: "delivery_completed",
          summary: "hidden", occurredAt: now - index, createdAt: now,
        });
      }
      await ctx.db.insert("freightFateDriverEvents", {
        driverId: "public-driver", eventId: "older-public", eventType: "delivery_completed",
        summary: "public", occurredAt: now - 300, createdAt: now,
      });
    });
    const result = await t.query(api.freightFate.getPublicUpdates, { limit: 10 });
    expect(result.updates.map((event) => event.eventId)).toEqual(["older-public"]);
  });

  // The read stops as soon as a page is full, so a run of equal timestamps
  // that straddles the page boundary is the one place early exit could drop
  // an event: the index does not order ties by eventId, and hidden rows in
  // the same tie group shift where the boundary falls.
  test("a tie group spanning the page boundary pages without gaps", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      for (const [driverId, driverVisibility] of [["tie-public", "public"], ["tie-hidden", "private"]] as const) {
        await ctx.db.insert("freightFateDrivers", {
          driverId, displayName: `Tie ${driverId}`, visibility: driverVisibility,
          driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
          sharingConsentedAt: now, createdAt: now, updatedAt: now,
        });
      }
      // Every event shares one timestamp, so the whole set is a single tie
      // group. Insertion order deliberately disagrees with eventId order at
      // both ends, so whichever way the index breaks ties, at least one event
      // that belongs on page one is only reached after the page is full.
      for (const suffix of ["m", "a", "h1", "z", "h2", "c"]) {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId: suffix.startsWith("h") ? "tie-hidden" : "tie-public",
          eventId: `tie-${suffix}`, eventType: "delivery_completed",
          summary: suffix, occurredAt: now, createdAt: now,
        });
      }
    });
    const seen: string[] = [];
    let before: { occurredAt: number; eventId: string } | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await t.query(api.freightFate.getPublicUpdates, { limit: 2, ...(before ? { before } : {}) });
      seen.push(...result.updates.map((event) => event.eventId));
      if (!result.nextBefore) break;
      before = result.nextBefore;
    }
    expect(seen).toEqual(["tie-z", "tie-m", "tie-c", "tie-a"]);
    expect(new Set(seen).size).toBe(4);
  });

  // One driver's own history pages the same way and for the same reason: the
  // by_driver_occurred index orders by timestamp only, so a run of equal
  // timestamps across a page boundary is where an early exit would lose an
  // event out of the middle of the road journal.
  test("a driver's own tie group pages without gaps", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "journal-driver", displayName: "Journal Driver", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      // Insertion order disagrees with eventId order at both ends, and one
      // event sits below the tie group so the last page has to reach past it.
      for (const suffix of ["m", "a", "z", "c"]) {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId: "journal-driver", eventId: `tie-${suffix}`, eventType: "delivery_completed",
          summary: suffix, occurredAt: now, createdAt: now,
        });
      }
      await ctx.db.insert("freightFateDriverEvents", {
        driverId: "journal-driver", eventId: "older", eventType: "delivery_completed",
        summary: "older", occurredAt: now - 500, createdAt: now,
      });
    });
    const seen: string[] = [];
    let before: { occurredAt: number; eventId: string } | undefined;
    for (let page = 0; page < 6; page += 1) {
      const profile = await t.query(api.freightFate.getDriverProfile, {
        driverId: "journal-driver", limit: 2, ...(before ? { before } : {}),
      });
      seen.push(...profile!.events.map((event) => event.eventId));
      if (!profile!.nextBefore) break;
      before = profile!.nextBefore;
    }
    expect(seen).toEqual(["tie-z", "tie-m", "tie-c", "tie-a", "older"]);
    expect(new Set(seen).size).toBe(5);
  });

  // Badges are capped the same way events are, and earnedAt ties break by
  // achievementKey, which their index does not order by either.
  test("the newest badges survive a tie at the cap", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "badge-driver", displayName: "Badge Driver", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, createdAt: now, updatedAt: now,
      });
      for (const [key, earnedAt] of [
        ["coast_to_coast", now],
        ["clean_delivery", now],
        ["first_delivery", now],
        ["abilene_arrival", now - 500],
      ] as const) {
        await ctx.db.insert("freightFateAchievements", {
          driverId: "badge-driver", achievementKey: key, name: key,
          description: key, earnedAt, createdAt: now,
        });
      }
    });
    const profile = await t.query(api.freightFate.getDriverProfile, {
      driverId: "badge-driver", achievementLimit: 2,
    });
    expect(profile!.achievements.map((badge) => badge.achievementKey))
      .toEqual(["first_delivery", "coast_to_coast"]);
  });

  test("returns the richer allowlisted snapshot and account achievement total", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "resume-driver", displayName: "Resume Driver", visibility: "public",
        driverTokenHash: "hash", sharingConsentVersion: SHARING_CONSENT_VERSION,
        sharingConsentedAt: now, publicSaveName: "Working Career",
        createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("freightFateProfileSnapshots", {
        driverId: "resume-driver", version: 1, saveName: "Working Career",
        businessStatus: "leased_owner_operator",
        employmentStatus: "Leased-on owner-operator",
        businessIdentity: "Leased-on owner-operator with Northstar Freight Lines",
        carrierName: "Northstar Freight Lines", level: 18,
        careerTitle: "Leased-On Owner-Operator", lastSavedCity: "Chicago, Illinois",
        truckName: "ridgeline sleeper", truckIsCarrierAssigned: false,
        deliveries: 100, milesDriven: 80_000, reputation: 92,
        onTimeDeliveries: 93, onTimeRate: 93,
        damageFreeDeliveries: 88, damageFreeRate: 88,
        citiesVisited: 120, statesVisited: 35, longestHaulMiles: 1_400,
        safetyRecord: {
          citations: 1, seriousViolations: 0, majorOffenses: 0, fatigueEvents: 0,
          cargoClaims: 1, preventableEquipmentDamage: 1,
          carrierTerminations: 0, repossessions: 0,
        },
        lifetimeEarnings: 750_000, netWorth: 186_000, netWorthComplete: true,
        badgesEarned: 1, endorsements: ["Hazmat"],
        meaningfulPlayedAt: now - 1_000, capturedAt: now, updatedAt: now,
        sourceSaveName: "Working Career", sourceRevision: 3, validatorVersion: 1,
        future: {
          currentCash: "CASH-PRIVATE-9182", availableCredit: "CREDIT-PRIVATE-3817",
          preciseLocation: "LOCATION-PRIVATE-4921", activeCargo: "CARGO-PRIVATE-7241",
          customer: "CUSTOMER-PRIVATE-8173", cargoValue: "VALUE-PRIVATE-9127",
          destination: "DESTINATION-PRIVATE-1278", fatigue: "FATIGUE-PRIVATE-2819",
          hos: "HOS-PRIVATE-3912", dispatcherStanding: "DISPATCHER-PRIVATE-4812",
        },
      });
      await ctx.db.insert("freightFatePresence", {
        driverId: "resume-driver", activity: "DESTINATION-PRIVATE-1278",
        detail: "LOCATION-PRIVATE-4921 CARGO-PRIVATE-7241",
        updatedAt: now, changedAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "resume-driver", achievementKey: "clean_delivery",
        name: "POISONED STORED NAME", description: "POISONED STORED DESCRIPTION",
        earnedAt: now - 2_000, createdAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "resume-driver", achievementKey: "first_delivery",
        importSource: "verified_save", importedAt: now, createdAt: now,
      });
      await ctx.db.insert("freightFateAchievements", {
        driverId: "resume-driver", achievementKey: "unknown_poisoned_key",
        name: "UNKNOWN POISONED NAME", description: "UNKNOWN POISONED DESCRIPTION",
        earnedAt: now - 1_000, createdAt: now,
      });
    });

    const profile = await t.query(api.freightFate.getDriverProfile, {
      driverId: "resume-driver", limit: 3, now,
    });
    expect(profile?.snapshot).toMatchObject({
      saveName: "Working Career",
      businessStatus: "leased_owner_operator",
      employmentStatus: "Leased-on owner-operator",
      businessIdentity: "Leased-on owner-operator with Northstar Freight Lines",
      carrierName: "Northstar Freight Lines",
      careerTitle: "Leased-On Owner-Operator",
      truckName: "ridgeline sleeper",
      truckIsCarrierAssigned: false,
      onTimeRate: 93,
      damageFreeRate: 88,
      safetyRecord: { citations: 1, cargoClaims: 1 },
      citiesVisited: 120,
      statesVisited: 35,
      longestHaulMiles: 1_400,
      lifetimeEarnings: 750_000,
      netWorth: 186_000,
      netWorthComplete: true,
      meaningfulPlayedAt: now - 1_000,
      capturedAt: now,
    });
    expect(profile?.achievementCount).toBe(2);
    expect(profile?.recentAchievements.map((badge) => badge.achievementKey)).toEqual(["clean_delivery"]);
    expect(profile?.achievements.map((badge) => badge.achievementKey)).toEqual(["clean_delivery", "first_delivery"]);
    expect(profile?.achievements).toEqual([
      expect.objectContaining({ achievementKey: "clean_delivery", label: "Pretty as a Billboard" }),
      expect.objectContaining({ achievementKey: "first_delivery", label: "Signed, Sealed, Hauled" }),
    ]);
    expect(profile?.achievements[0]).not.toHaveProperty("name");
    expect(profile?.achievements[0]).not.toHaveProperty("description");
    expect(JSON.stringify(profile)).not.toContain("POISONED");
    for (const sentinel of [
      "CASH-PRIVATE-9182", "CREDIT-PRIVATE-3817", "LOCATION-PRIVATE-4921",
      "CARGO-PRIVATE-7241", "CUSTOMER-PRIVATE-8173", "VALUE-PRIVATE-9127",
      "DESTINATION-PRIVATE-1278", "FATIGUE-PRIVATE-2819", "HOS-PRIVATE-3912",
      "DISPATCHER-PRIVATE-4812",
    ]) expect(JSON.stringify(profile)).not.toContain(sentinel);
    expect(profile?.snapshot).not.toHaveProperty("sourceSaveName");
    expect(profile?.snapshot).not.toHaveProperty("lastSavedCity");
    expect(profile?.snapshot?.safetyRecord).not.toHaveProperty("fatigueEvents");
    for (const privateKey of [
      "money", "currentCash", "availableCredit", "activeTrip", "fatigue", "hos",
      "dispatcherStanding",
    ]) {
      expect(profile?.snapshot).not.toHaveProperty(privateKey);
    }
  });
});

describe("per-computer tokens", () => {
  test("adding a computer never signs out the others (issue #64)", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      expandedSharingConsent: true,
      now,
    });
    const laptop = await connectComputer(t, SUBJECT, "Laptop", now + 1);
    expect(laptop).not.toBe(first.token);

    // Both machines heartbeat successfully — neither token retired the other.
    for (const token of [first.token, laptop]) {
      const beat = await t.mutation(api.freightFate.updatePresence, {
        driverId: first.driverId,
        driverTokenHash: await sha256Hex(token),
        activity: "Hauling",
        detail: "",
        now: now + 2,
      });
      expect(beat).toMatchObject({ ok: true });
    }

    const computers = await as.query(api.freightFate.getMyComputers, {});
    expect(computers!.hasLegacyToken).toBe(false);
    expect(computers!.computers.map((c) => c.label)).toEqual(["My computer", "Laptop"]);
  });

  test("signing out one computer leaves the rest connected", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const laptop = await connectComputer(t, SUBJECT, "Laptop", now);
    const computers = await as.query(api.freightFate.getMyComputers, {});
    const laptopRow = computers!.computers.find((c) => c.label === "Laptop")!;

    const removed = await as.mutation(api.freightFate.removeComputer, {
      tokenId: laptopRow.id,
      now: now + 1,
    });
    expect(removed.removed).toBe(true);

    const laptopFails = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(laptop),
      activity: "Hauling",
      detail: "",
      now: now + 2,
    });
    expect(laptopFails).toMatchObject({ ok: false, reason: "unauthorized" });

    const firstStillWorks = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token),
      activity: "Hauling",
      detail: "",
      now: now + 3,
    });
    expect(firstStillWorks).toMatchObject({ ok: true });
  });

  test("a pre-computer-list legacy token keeps working and can be retired", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();
    const legacyToken = "ffd_legacy_token_from_before_the_computer_list";

    // A driver row exactly as provisionDriver wrote it before device tokens.
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "rig-hauler-00000000",
        displayName: "Rig Hauler",
        visibility: "public",
        authSubject: SUBJECT,
        driverTokenHash: await sha256Hex(legacyToken),
        createdAt: now,
        updatedAt: now,
      });
    });

    const beat = await t.mutation(api.freightFate.updatePresence, {
      driverId: "rig-hauler-00000000",
      driverTokenHash: await sha256Hex(legacyToken),
      activity: "Hauling",
      detail: "",
      now,
    });
    expect(beat).toMatchObject({ ok: true });

    const computers = await as.query(api.freightFate.getMyComputers, {});
    expect(computers!.hasLegacyToken).toBe(true);

    const removed = await as.mutation(api.freightFate.removeComputer, {
      tokenId: "legacy",
      now: now + 1,
    });
    expect(removed.removed).toBe(true);
    expect((await as.query(api.freightFate.getMyComputers, {}))!.hasLegacyToken).toBe(false);

    const legacyFails = await t.mutation(api.freightFate.updatePresence, {
      driverId: "rig-hauler-00000000",
      driverTokenHash: await sha256Hex(legacyToken),
      activity: "Hauling",
      detail: "",
      now: now + 2,
    });
    expect(legacyFails).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  test("rotateToken is the full sign-out: every computer dies and none is issued", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const laptop = await connectComputer(t, SUBJECT, "Laptop", now);

    const rotated = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      rotateToken: true,
      now: now + 1,
    });
    expect(rotated.rotated).toBe(true);

    for (const dead of [first.token, laptop]) {
      const fails = await t.mutation(api.freightFate.updatePresence, {
        driverId: first.driverId,
        driverTokenHash: await sha256Hex(dead),
        activity: "Hauling",
        detail: "",
        now: now + 2,
      });
      expect(fails).toMatchObject({ ok: false, reason: "unauthorized" });
    }

    // The list agrees with what the page tells the player: nothing is
    // connected, and every computer has to activate again. A fresh token
    // issued here would have shown one connected computer no computer held.
    expect((await as.query(api.freightFate.getMyComputers, {}))!.computers).toHaveLength(0);

    const reconnected = await connectComputer(t, SUBJECT, "Studio desktop", now + 3);
    const fresh = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(reconnected),
      activity: "Hauling",
      detail: "",
      now: now + 3,
    });
    expect(fresh).toMatchObject({ ok: true });
    expect((await as.query(api.freightFate.getMyComputers, {}))!.computers).toHaveLength(1);
  });

  test("computer management requires the owning account", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const other = t.withIdentity({ subject: OTHER });
    const now = Date.now();

    await provisionWithComputer(t, SUBJECT, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });
    const computers = await as.query(api.freightFate.getMyComputers, {});
    const row = computers!.computers[0]!;

    // Another signed-in account cannot see or remove them.
    expect(await other.query(api.freightFate.getMyComputers, {})).toBeNull();

    await other.mutation(api.freightFate.provisionDriver, {
      displayName: "Other Driver",
      visibility: "private",
      now,
    });
    const crossRemove = await other.mutation(api.freightFate.removeComputer, {
      tokenId: row.id,
      now,
    });
    expect(crossRemove.removed).toBe(false);
  });
});
