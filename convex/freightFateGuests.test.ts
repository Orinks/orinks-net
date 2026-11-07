/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { hashDeviceCode } from "./freightFateActivation";
import { FREIGHT_FATE_ACHIEVEMENT_IDS } from "./freightFateProfileCatalog";
import { GUEST_CREATE_LIMIT } from "./freightFateGuests";

function setup() {
  const modules = import.meta.glob("./**/*.ts");
  return convexTest(schema, modules);
}
const NOW = 1_760_000_000_000;
const SUBJECT = "user_2guestowner";

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type T = ReturnType<typeof setup>;

async function makeGuest(t: T, name = "Copper Fox 12", clientKey = "203.0.113.5") {
  const made = await t.mutation(api.freightFateGuests.createGuest, { clientKey, name, now: NOW });
  if (!made.ok) throw new Error("guest not made");
  return { ...made, tokenHash: await sha256(made.token) };
}

async function share(t: T, guest: { driverId: string; tokenHash: string }) {
  return await t.mutation(api.freightFate.setProfileSharing, {
    driverId: guest.driverId, driverTokenHash: guest.tokenHash, enabled: true, now: NOW,
  });
}

async function goOnDuty(t: T, guest: { driverId: string; tokenHash: string }) {
  return await t.mutation(api.freightFate.updatePresence, {
    driverId: guest.driverId, driverTokenHash: guest.tokenHash, activity: "Driving", detail: "I-80", now: NOW,
  });
}

async function connect(t: T, guest: { driverId: string; tokenHash: string }, displayName?: string) {
  const started = await t.mutation(api.freightFateActivation.startActivation, {
    clientKey: "203.0.113.5", now: NOW, guestDriverId: guest.driverId, guestTokenHash: guest.tokenHash,
  });
  const claimed = await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
    userCode: started.userCode, now: NOW + 1000, ...(displayName ? { displayName } : {}),
  });
  const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
    deviceCodeHash: await hashDeviceCode(started.deviceCode), now: NOW + 2000,
  });
  return { claimed, redeemed };
}

type Table =
  | "freightFateDriverEvents" | "freightFateAchievements" | "freightFateDrivers" | "freightFateDeviceTokens"
  | "freightFatePresence";
async function rows<N extends Table>(t: T, table: N): Promise<Doc<N>[]> {
  return await t.run(async (ctx) => (await ctx.db.query(table).collect()) as Doc<N>[]);
}

describe("createGuest", () => {
  test("makes a private guest driver with a token for this computer", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    expect(guest.driverId).toMatch(/^guest-[0-9a-f]{16}$/);
    expect(guest.displayName).toBe("Copper Fox 12");
    const [driver] = await rows(t, "freightFateDrivers");
    expect(driver).toMatchObject({ guest: true, visibility: "private", displayName: "Copper Fox 12" });
    expect(driver.authSubject).toBeUndefined();
    const [device] = await rows(t, "freightFateDeviceTokens");
    expect(device.tokenHash).toBe(guest.tokenHash);
  });

  test("refuses a name that is not a word-list name", async () => {
    const t = setup();
    await expect(
      t.mutation(api.freightFateGuests.createGuest, { clientKey: "x", name: "Rude Words Here", now: NOW }),
    ).rejects.toThrow();
  });

  test("answers name_taken for a name already on the board", async () => {
    const t = setup();
    await makeGuest(t);
    const again = await t.mutation(api.freightFateGuests.createGuest, {
      clientKey: "198.51.100.7", name: "Copper Fox 12", now: NOW,
    });
    expect(again).toEqual({ ok: false, code: "name_taken" });
  });

  test("limits new guests from one address", async () => {
    const t = setup();
    for (let i = 0; i < GUEST_CREATE_LIMIT; i++) await makeGuest(t, `Copper Fox ${i + 1}`);
    await expect(makeGuest(t, "Copper Fox 50")).rejects.toThrow();
  });

});

describe("what a guest gets", () => {
  test("a place on the drivers board, marked as a guest", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    expect(await share(t, guest)).toMatchObject({ ok: true });
    expect(await goOnDuty(t, guest)).toMatchObject({ ok: true });
    const board = await t.query(api.freightFate.getLivePresenceBoard, {});
    expect(board.drivers).toEqual([
      expect.objectContaining({ driverId: guest.driverId, displayName: "Copper Fox 12", guest: true }),
    ]);
  });

  test("no profile and no directory entry", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    await share(t, guest);
    await goOnDuty(t, guest);
    expect(await t.query(api.freightFate.getDriverProfile, { driverId: guest.driverId, now: NOW })).toBeNull();
    const directory = await t.query(api.freightFate.getDriverDirectory, { now: NOW });
    expect(JSON.stringify(directory)).not.toContain(guest.driverId);
  });

  test("no road journal and no achievements", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    await share(t, guest);
    const event = await t.mutation(api.freightFate.recordDriverEvent, {
      driverId: guest.driverId, driverTokenHash: guest.tokenHash, eventId: "guest-delivery-1",
      eventType: "delivery_completed", summary: "Steel coils to Denver.", occurredAt: NOW, now: NOW,
    });
    expect(event).toMatchObject({ ok: false, reason: "account_required" });
    const achievement = await t.mutation(api.freightFate.publishAchievementEarned, {
      driverId: guest.driverId, driverTokenHash: guest.tokenHash, eventId: "guest-ach-1",
      achievementKey: FREIGHT_FATE_ACHIEVEMENT_IDS[0], name: "First", description: "First one.",
      earnedAt: NOW, now: NOW,
    });
    expect(achievement).toMatchObject({ ok: false });
    expect(await rows(t, "freightFateDriverEvents")).toHaveLength(0);
    expect(await rows(t, "freightFateAchievements")).toHaveLength(0);
  });
});

describe("renameGuest", () => {
  test("gives a guest a new name, on the board too", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFatePresence", {
        driverId: guest.driverId, activity: "Driving", detail: "", displayName: "Copper Fox 12", listed: true,
      });
    });
    const result = await t.mutation(api.freightFateGuests.renameGuest, {
      driverId: guest.driverId, driverTokenHash: guest.tokenHash, name: "Quiet Heron 7", now: NOW,
    });
    expect(result).toEqual({ ok: true, displayName: "Quiet Heron 7" });
    const presence = await t.run(async (ctx) => await ctx.db.query("freightFatePresence").first());
    expect(presence?.displayName).toBe("Quiet Heron 7");
  });

  test("refuses a wrong token and an account driver", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    const wrong = await t.mutation(api.freightFateGuests.renameGuest, {
      driverId: guest.driverId, driverTokenHash: "0".repeat(64), name: "Quiet Heron 7", now: NOW,
    });
    expect(wrong).toEqual({ ok: false, reason: "unauthorized" });
    await connect(t, guest);
    const adopted = await t.mutation(api.freightFateGuests.renameGuest, {
      driverId: guest.driverId, driverTokenHash: guest.tokenHash, name: "Quiet Heron 7", now: NOW + 5000,
    });
    expect(adopted).toEqual({ ok: false, reason: "not_a_guest" });
  });
});

describe("connecting an account", () => {
  test("an account with no driver adopts the guest, which can then have a profile", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    await share(t, guest);
    const { claimed, redeemed } = await connect(t, guest);
    expect(claimed).toEqual({ ok: true });
    expect(redeemed).toMatchObject({ driverId: guest.driverId, displayName: "Copper Fox 12" });
    const [driver] = await rows(t, "freightFateDrivers");
    expect(driver.authSubject).toBe(SUBJECT);
    expect(driver.guest).toBeUndefined();
    expect(driver.visibility).toBe("public");
    if (!redeemed || !("token" in redeemed)) throw new Error("not redeemed");
    const event = await t.mutation(api.freightFate.recordDriverEvent, {
      driverId: guest.driverId, driverTokenHash: await sha256(redeemed.token as string), eventId: "d-1",
      eventType: "delivery_completed", summary: "Steel coils to Denver.", occurredAt: NOW, now: NOW + 3000,
    });
    expect(event).toMatchObject({ ok: true });
    expect(await t.query(api.freightFate.getDriverProfile, { driverId: guest.driverId, now: NOW })).not.toBeNull();
  });

  test("the board stops marking an adopted guest", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    await share(t, guest);
    await goOnDuty(t, guest);
    const { redeemed } = await connect(t, guest);
    if (!redeemed || !("token" in redeemed)) throw new Error("not redeemed");
    await t.mutation(api.freightFate.updatePresence, {
      driverId: guest.driverId, driverTokenHash: await sha256(redeemed.token as string), activity: "Driving",
      detail: "I-80", now: NOW + 3000,
    });
    const board = await t.query(api.freightFate.getLivePresenceBoard, {});
    expect(board.drivers[0]).not.toHaveProperty("guest");
  });

  test("an account with a driver retires the guest", async () => {
    const t = setup();
    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFate.provisionDriver, {
      displayName: "Road Star", visibility: "public", expandedSharingConsent: true, now: NOW,
    });
    const guest = await makeGuest(t);
    await share(t, guest);
    await goOnDuty(t, guest);
    const { claimed, redeemed } = await connect(t, guest);
    expect(claimed).toEqual({ ok: true });
    expect(redeemed).toMatchObject({ displayName: "Road Star" });
    const drivers = await rows(t, "freightFateDrivers");
    expect(drivers.map((d) => d.displayName)).toEqual(["Road Star"]);
    const accountId = drivers[0].driverId;
    // Only the account's new token is left, and the guest is off the board.
    const devices = await rows(t, "freightFateDeviceTokens");
    expect(devices.map((d) => d.driverId)).toEqual([accountId]);
    expect(await rows(t, "freightFatePresence")).toHaveLength(0);
  });

  test("a first-run account that types a name retires the guest too", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    const { claimed, redeemed } = await connect(t, guest, "Night Hauler");
    expect(claimed).toEqual({ ok: true });
    expect(redeemed).toMatchObject({ displayName: "Night Hauler" });
    const drivers = await rows(t, "freightFateDrivers");
    expect(drivers.map((d) => d.displayName)).toEqual(["Night Hauler"]);
  });

  test("a code started without the guest's token connects as usual", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "203.0.113.5", now: NOW, guestDriverId: guest.driverId, guestTokenHash: "0".repeat(64),
    });
    const claimed = await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode, now: NOW + 1000,
    });
    expect(claimed).toEqual({ ok: false, code: "no_driver" });
    const [driver] = await rows(t, "freightFateDrivers");
    expect(driver.guest).toBe(true);
  });
});

describe("cloud backups", () => {
  test("are refused for guests", async () => {
    const t = setup();
    const guest = await makeGuest(t);
    const listed = await t.query(api.freightFateSaves.listSaves, {
      driverId: guest.driverId, driverTokenHash: guest.tokenHash,
    });
    expect(listed).toMatchObject({ ok: false, reason: "account_required" });
  });
});
