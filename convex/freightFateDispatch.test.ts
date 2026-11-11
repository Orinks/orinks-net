/// <reference types="vite/client" />
// Live dispatch, proved with a fake driver: one account runs a carrier the way
// Dispatch's live desk will, another plays the Freight Fate driver, and both
// go through the same calls and heartbeat the games will make.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  LOAD_OFFER_DEFAULT_MS,
  NIGHT_DESK_COOLDOWN_MS,
  nightDeskLane,
} from "./freightFateDispatch";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type T = ReturnType<typeof setup>;

/** A driver with one connected computer, signed up the way a player does. */
async function player(t: T, subject: string, displayName: string, now: number) {
  const { driverId } = await t
    .withIdentity({ subject })
    .mutation(api.freightFate.provisionDriver, { displayName, visibility: "private", now });
  const started = await t.mutation(api.freightFateActivation.startActivation, { clientKey: subject, now });
  await t.withIdentity({ subject }).mutation(api.freightFateActivation.claimActivation, {
    userCode: started.userCode,
    label: "Desktop",
    now,
  });
  const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
    deviceCodeHash: await sha256Hex(started.deviceCode),
    now,
  });
  const token = redeemed!.token;
  return { driverId, token, auth: { driverId, driverTokenHash: await sha256Hex(token) } };
}

/** The game's heartbeat, through the same HTTP door production uses. */
async function beat(t: T, who: { driverId: string; token: string }, body: Record<string, unknown>) {
  const reply = await t.fetch("/freight-fate/presence", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "FreightFate/v1.9.0",
      authorization: `Bearer ${who.token}`,
    },
    body: JSON.stringify({ driverId: who.driverId, ...body }),
  });
  return { status: reply.status, body: await reply.json() };
}

const DESK = "user_desk";
const ROAD = "user_road";
const OTHER = "user_other";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.FREIGHT_FATE_LIVE_DISPATCH;
  process.env.FREIGHT_FATE_LIVE_DISPATCH = "on";
});
afterEach(() => {
  if (saved === undefined) delete process.env.FREIGHT_FATE_LIVE_DISPATCH;
  else process.env.FREIGHT_FATE_LIVE_DISPATCH = saved;
});

/** A carrier with one driver in it, both sides signed in. */
async function carrierWithDriver(t: T, now: number, lanes: unknown[] = []) {
  const desk = await player(t, DESK, "Night Owl", now);
  const road = await player(t, ROAD, "Road Star", now);
  const created = await t.mutation(api.freightFateDispatch.createCarrier, {
    ...desk.auth,
    name: "Owl Freight",
    homeTerminal: "Chicago, IL",
    lanes,
    now,
  });
  if (!created.ok) throw new Error(created.reason);
  const joined = await t.mutation(api.freightFateDispatch.joinCarrier, {
    ...road.auth,
    inviteCode: created.inviteCode,
    now,
  });
  if (!joined.ok) throw new Error(joined.reason);
  return { desk, road, carrierId: created.carrierId, inviteCode: created.inviteCode };
}

async function deskView(t: T, auth: { driverId: string; driverTokenHash: string }, now: number) {
  const desk = await t.query(api.freightFateDispatch.getCarrierDesk, { ...auth, now });
  if (!desk.ok) throw new Error(desk.reason);
  return desk;
}

async function driverView(t: T, auth: { driverId: string; driverTokenHash: string }, now: number) {
  const mine = await t.query(api.freightFateDispatch.getMyDispatch, { ...auth, now });
  if (!mine.ok) throw new Error(mine.reason);
  return mine;
}

describe("the flag", () => {
  test("with the flag off every call is refused, the heartbeat is unchanged and the night desk reads nothing", async () => {
    delete process.env.FREIGHT_FATE_LIVE_DISPATCH;
    const t = setup();
    const now = Date.now();
    const desk = await player(t, DESK, "Night Owl", now);

    expect(await t.query(api.freightFateDispatch.getMyDispatch, { ...desk.auth, now }))
      .toEqual({ ok: false, reason: "not_enabled" });
    expect(await t.mutation(api.freightFateDispatch.createCarrier, {
      ...desk.auth, name: "Owl Freight", homeTerminal: "Chicago, IL", now,
    })).toEqual({ ok: false, reason: "not_enabled" });

    const reply = await beat(t, desk, { activity: "Driving", detail: "I-55", truck: { city: "Joliet, IL", loaded: false } });
    expect(reply.body).toEqual({ ok: true, cleared: false });

    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now }))
      .toEqual({ lapsed: 0, offered: 0 });
  });

  test("a list of driver ids opens it to those drivers only", async () => {
    const t = setup();
    const now = Date.now();
    const desk = await player(t, DESK, "Night Owl", now);
    const other = await player(t, OTHER, "Other Hand", now);
    process.env.FREIGHT_FATE_LIVE_DISPATCH = `${desk.driverId}, someone-else-1234`;

    expect((await t.query(api.freightFateDispatch.getMyDispatch, { ...desk.auth, now })).ok).toBe(true);
    expect(await t.query(api.freightFateDispatch.getMyDispatch, { ...other.auth, now }))
      .toEqual({ ok: false, reason: "not_enabled" });
  });
});

describe("a fake driver run end to end", () => {
  test("join, heartbeat, load offer, counter, accept, route, deliver, and the desk hears each step", async () => {
    const t = setup();
    const now = Date.now();
    const desk = await player(t, DESK, "Night Owl", now);
    const road = await player(t, ROAD, "Road Star", now);

    // The dispatcher opens a carrier and reads the code out.
    const created = await t.mutation(api.freightFateDispatch.createCarrier, {
      ...desk.auth, name: "Owl Freight", homeTerminal: "Chicago, IL", now,
    });
    expect(created).toMatchObject({ ok: true, created: true });
    if (!created.ok) return;
    expect(created.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    // Asking again gives back the same carrier, never a second one.
    expect(await t.mutation(api.freightFateDispatch.createCarrier, {
      ...desk.auth, name: "Another", homeTerminal: "Gary, IN", now,
    })).toMatchObject({ ok: true, created: false, carrierId: created.carrierId });

    // The driver types it however it was heard.
    const spoken = `${created.inviteCode.slice(0, 4).toLowerCase()} ${created.inviteCode.slice(4)}`;
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...road.auth, inviteCode: spoken, now }))
      .toEqual({ ok: true, joined: true, carrierId: created.carrierId, carrierName: "Owl Freight" });

    // Signed on in Gary, empty. The heartbeat says nothing is waiting.
    const signOn = await beat(t, road, {
      activity: "At the yard",
      detail: "Gary, IN",
      truck: { city: "Gary, IN", hosMinutesLeft: 600, fuelPercent: 80, loaded: false },
    });
    expect(signOn.body).toEqual({ ok: true, cleared: false, dispatch: { carrierId: created.carrierId, openOrders: 0 } });
    await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-signon", kind: "signed_on", now,
    });

    let view = await deskView(t, desk.auth, now + 1000);
    expect(view.roster).toHaveLength(1);
    expect(view.roster[0]).toMatchObject({
      driverId: road.driverId,
      displayName: "Road Star",
      online: true,
      truck: { city: "Gary, IN", hosMinutesLeft: 600, fuelPercent: 80, loaded: false },
    });
    expect(view.replies.map((r) => r.kind)).toEqual(["joined", "signed_on"]);
    expect(view.replies[1].payload).toEqual({ truck: { city: "Gary, IN", hosMinutesLeft: 600, fuelPercent: 80, loaded: false } });

    // The desk offers a load. A retry with the same id is a no-op.
    const offer = {
      ...desk.auth,
      orderId: "o-steel",
      memberDriverId: road.driverId,
      kind: "load_offer" as const,
      payload: {
        jobSeed: "7f3a19c2",
        origin: "Gary, IN",
        destination: "Dallas, TX",
        cargo: "Steel coils",
        pay: 2400,
        appointment: "Thursday 2 PM",
        routeName: "I-57 to I-30",
        fuelStop: "Effingham, IL",
      },
      now,
    };
    expect(await t.mutation(api.freightFateDispatch.postOrder, offer))
      .toEqual({ ok: true, duplicate: false, orderId: "o-steel", status: "open", expiresAt: now + LOAD_OFFER_DEFAULT_MS });
    expect(await t.mutation(api.freightFateDispatch.postOrder, offer)).toMatchObject({ duplicate: true });

    // The next heartbeat tells the game to fetch it.
    expect((await beat(t, road, { activity: "At the yard", detail: "Gary, IN" })).body.dispatch)
      .toEqual({ carrierId: created.carrierId, openOrders: 1 });
    let mine = await driverView(t, road.auth, now);
    expect(mine.carrier).toMatchObject({ name: "Owl Freight", nightDispatcher: true, notesMuted: false });
    expect(mine.orders).toHaveLength(1);
    expect(mine.orders[0]).toMatchObject({ orderId: "o-steel", kind: "load_offer", status: "open" });
    expect(mine.orders[0].payload).toMatchObject({ destination: "Dallas, TX", routeName: "I-57 to I-30" });

    // A counter leaves the offer open; then the driver takes it.
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-counter", orderId: "o-steel", kind: "counter",
      payload: { hosMinutesLeft: 360, canReach: "Little Rock, AR" }, now,
    })).toEqual({ ok: true, duplicate: false, orderStatus: "open" });
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-accept", orderId: "o-steel", kind: "accepted", now,
    })).toEqual({ ok: true, duplicate: false, orderStatus: "accepted" });
    // The same reply again is safe.
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-accept", orderId: "o-steel", kind: "accepted", now,
    })).toEqual({ ok: true, duplicate: true });

    // The desk changes the route for this load, the driver takes it.
    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o-route", memberDriverId: road.driverId, kind: "route",
      payload: { loadOrderId: "o-steel", routeName: "I-65 to I-40", fuelStop: "Memphis, TN" }, now,
    });
    await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-route", orderId: "o-route", kind: "accepted", now,
    });

    // On the road, loaded; the desk sees the change.
    await beat(t, road, {
      activity: "Driving",
      detail: "I-65 south",
      truck: { city: "Indianapolis, IN", nextWaypoint: "Louisville, KY", hosMinutesLeft: 420, fuelPercent: 61, cargo: "Steel coils", loaded: true },
    });
    view = await deskView(t, desk.auth, now + 2000);
    expect(view.roster[0].truck).toMatchObject({ city: "Indianapolis, IN", cargo: "Steel coils", loaded: true });
    expect(view.orders.map((o) => [o.orderId, o.status])).toEqual([["o-steel", "accepted"], ["o-route", "accepted"]]);

    // Delivered: the load and its route both close.
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-done", orderId: "o-steel", kind: "delivered",
      payload: { onTime: false, minutesLate: 45, lateReason: "Weigh station in Arkansas", miles: 933, detentionMinutes: 30 }, now,
    })).toEqual({ ok: true, duplicate: false, orderStatus: "done" });
    mine = await driverView(t, road.auth, now);
    expect(mine.orders).toEqual([]);

    view = await deskView(t, desk.auth, now + 3000);
    expect(view.orders).toEqual([]);
    expect(view.replies.map((r) => r.kind)).toEqual(["joined", "signed_on", "counter", "accepted", "accepted", "delivered"]);
    const delivered = view.replies.find((r) => r.kind === "delivered")!;
    expect(delivered.payload).toEqual({ onTime: false, minutesLate: 45, lateReason: "Weigh station in Arkansas", miles: 933, detentionMinutes: 30 });

    // The desk has heard them all.
    expect(await t.mutation(api.freightFateDispatch.markRepliesRead, {
      ...desk.auth, replyIds: view.replies.map((r) => r.replyId), now,
    })).toEqual({ ok: true, marked: 6 });
    expect((await deskView(t, desk.auth, now)).replies).toEqual([]);

    // Signing off parks the truck where it stopped; the desk still sees it.
    await beat(t, road, {
      activity: "",
      detail: "",
      truck: { city: "Dallas, TX", hosMinutesLeft: 0, fuelPercent: 22, loaded: false },
    });
    view = await deskView(t, desk.auth, now + 4000);
    expect(view.roster[0]).toMatchObject({ online: false, truck: { city: "Dallas, TX", loaded: false } });
  });

  test("the wrong token, a stranger's order and the desk's own calls from a driver are all refused", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);

    expect(await t.query(api.freightFateDispatch.getMyDispatch, {
      driverId: road.driverId, driverTokenHash: await sha256Hex("ffd_wrong_wrong_wrong_wrong"), now,
    })).toEqual({ ok: false, reason: "unauthorized" });

    // A driver has no desk of their own.
    expect(await t.query(api.freightFateDispatch.getCarrierDesk, { ...road.auth, now }))
      .toEqual({ ok: false, reason: "no_carrier" });
    expect(await t.mutation(api.freightFateDispatch.postOrder, {
      ...road.auth, orderId: "x", memberDriverId: desk.driverId, kind: "note", payload: { text: "hi" }, now,
    })).toEqual({ ok: false, reason: "no_carrier" });

    // A reply to an order that does not exist.
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r1", orderId: "nope", kind: "accepted", now,
    })).toEqual({ ok: false, reason: "order_not_found" });

    // A load offer with no seed.
    expect(await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o1", memberDriverId: road.driverId, kind: "load_offer",
      payload: { origin: "Gary, IN", destination: "Dallas, TX" }, now,
    })).toEqual({ ok: false, reason: "invalid_payload", field: "jobSeed" });
  });
});

describe("orders expire", () => {
  test("an offer nobody takes lapses, the desk hears it, and a late answer is told so", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o-late", memberDriverId: road.driverId, kind: "load_offer",
      payload: { jobSeed: "abc", origin: "Gary, IN", destination: "Dallas, TX", pickupBy: now + 60 * 60_000 }, now,
    });

    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: now + 30 * 60_000 }))
      .toMatchObject({ lapsed: 0 });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: now + 61 * 60_000 }))
      .toMatchObject({ lapsed: 1 });

    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-late", orderId: "o-late", kind: "accepted", now: now + 62 * 60_000,
    })).toEqual({ ok: false, reason: "order_closed", status: "lapsed" });

    const view = await deskView(t, desk.auth, now);
    const lapsed = view.replies.find((r) => r.kind === "lapsed")!;
    expect(lapsed).toMatchObject({ orderId: "o-late", source: "server", payload: { orderKind: "load_offer", wasAccepted: false } });
    expect((await driverView(t, road.auth, now)).orders).toEqual([]);
  });

  test("a pickup window outside ten minutes to seven days is refused", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    expect(await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o", memberDriverId: road.driverId, kind: "load_offer",
      payload: { jobSeed: "a", origin: "A", destination: "B", pickupBy: now + 60_000 }, now,
    })).toEqual({ ok: false, reason: "invalid_payload", field: "pickupBy" });
  });
});

describe("the night desk", () => {
  test("puts a signed-on, empty driver with nothing queued on a load from the carrier's lanes, once", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now, [
      { destination: "Denver, CO" },
      { origin: "Memphis, TN", destination: "Dallas, TX", cargo: "Paper rolls" },
    ]);
    await beat(t, road, { activity: "At the dock", detail: "Memphis", truck: { city: "Memphis, TN", loaded: false } });

    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: now + 1000 }))
      .toEqual({ lapsed: 0, offered: 1 });
    const mine = await driverView(t, road.auth, now);
    expect(mine.orders).toHaveLength(1);
    // A lane out of Memphis wins over a lane from anywhere.
    expect(mine.orders[0]).toMatchObject({
      kind: "load_offer",
      source: "night_desk",
      payload: { origin: "Memphis, TN", destination: "Dallas, TX", cargo: "Paper rolls" },
    });
    const view = await deskView(t, desk.auth, now);
    expect(view.replies.at(-1)).toMatchObject({
      kind: "night_desk",
      driverId: road.driverId,
      payload: { origin: "Memphis, TN", destination: "Dallas, TX", cargo: "Paper rolls" },
    });

    // Nothing more while that offer is open.
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: now + 2000 }))
      .toMatchObject({ offered: 0 });

    // Declined: not offered again until the cooldown passes.
    await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "r-no", orderId: mine.orders[0].orderId, kind: "declined", payload: { reason: "Need a reset" }, now,
    });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: now + 60_000 }))
      .toMatchObject({ offered: 0 });
    // Still waiting at the dock half an hour later.
    const later = now + NIGHT_DESK_COOLDOWN_MS + 2000;
    await t.mutation(api.freightFate.updatePresence, {
      ...road.auth, activity: "At the dock", detail: "Memphis, still", now: later,
    });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now: later }))
      .toMatchObject({ offered: 1 });
  });

  test("leaves alone a driver who is loaded, signed off, switched off, or already has orders", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now, [{ destination: "Denver, CO" }]);

    // Loaded.
    await beat(t, road, { activity: "Driving", detail: "I-80", truck: { city: "Omaha, NE", loaded: true } });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now })).toMatchObject({ offered: 0 });

    // Empty, but the dispatcher switched the night desk off for them.
    await beat(t, road, { activity: "At the dock", detail: "Omaha", truck: { city: "Omaha, NE", loaded: false } });
    await t.mutation(api.freightFateDispatch.setMemberSettings, {
      ...desk.auth, memberDriverId: road.driverId, nightDispatcher: false, now,
    });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now })).toMatchObject({ offered: 0 });

    // Back on, but the desk already queued a run home.
    await t.mutation(api.freightFateDispatch.setMemberSettings, {
      ...desk.auth, memberDriverId: road.driverId, nightDispatcher: null, now,
    });
    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o-home", memberDriverId: road.driverId, kind: "go_home",
      payload: { terminal: "Chicago, IL", byWhen: "Friday" }, now,
    });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now })).toMatchObject({ offered: 0 });

    // Signed off.
    await t.mutation(api.freightFateDispatch.withdrawOrder, { ...desk.auth, orderId: "o-home", now });
    await beat(t, road, { activity: "", detail: "" });
    expect(await t.mutation(internal.freightFateDispatch.dispatchTick, { now })).toMatchObject({ offered: 0 });
  });

  test("with no lane from here it brings the truck toward a terminal", () => {
    const carrier = { lanes: [{ origin: "Memphis, TN", destination: "Dallas, TX" }], homeTerminal: "Chicago, IL" };
    expect(nightDeskLane(carrier, "Omaha, NE", 0)).toEqual({ destination: "Chicago, IL" });
    expect(nightDeskLane(carrier, "chicago, il", 0)).toBeNull();
    expect(nightDeskLane({ ...carrier, secondTerminal: "Atlanta, GA" }, "Chicago, IL", 0))
      .toEqual({ destination: "Atlanta, GA" });
  });
});

describe("membership", () => {
  test("one carrier per driver; leaving clears the queue and the desk hears it", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    const other = await player(t, OTHER, "Other Hand", now);
    const second = await t.mutation(api.freightFateDispatch.createCarrier, {
      ...other.auth, name: "Second Line", homeTerminal: "Atlanta, GA", now,
    });
    if (!second.ok) throw new Error(second.reason);

    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...road.auth, inviteCode: second.inviteCode, now }))
      .toEqual({ ok: false, reason: "already_in_carrier" });
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...road.auth, inviteCode: "ZZZZZZZZ", now }))
      .toEqual({ ok: false, reason: "invite_not_found" });

    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o-q", memberDriverId: road.driverId, kind: "go_home", payload: { terminal: "Chicago, IL" }, now,
    });
    expect(await t.mutation(api.freightFateDispatch.leaveCarrier, { ...road.auth, now })).toEqual({ ok: true, left: true });
    expect((await deskView(t, desk.auth, now)).orders).toEqual([]);
    expect((await deskView(t, desk.auth, now)).roster).toEqual([]);
    expect((await deskView(t, desk.auth, now)).replies.at(-1)).toMatchObject({ kind: "left", driverId: road.driverId });
    // Leaving is not news to the driver who left.
    expect((await driverView(t, road.auth, now)).ended).toBeUndefined();

    // Switching is leave, then join.
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...road.auth, inviteCode: second.inviteCode, now }))
      .toMatchObject({ ok: true, joined: true, carrierName: "Second Line" });
  });

  test("a released driver is told once whose carrier let them go", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    await t.mutation(api.freightFateDispatch.releaseDriver, { ...desk.auth, memberDriverId: road.driverId, now });
    const mine = await driverView(t, road.auth, now + 1000);
    expect(mine.carrier).toBeNull();
    expect(mine.ended).toEqual({ carrierName: "Owl Freight", reason: "released", at: now });
  });

  test("closing a carrier releases everyone, and the old invite code stops working", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road, inviteCode } = await carrierWithDriver(t, now);
    expect(await t.mutation(api.freightFateDispatch.closeCarrier, { ...desk.auth, now })).toEqual({ ok: true, released: 1 });
    expect((await driverView(t, road.auth, now)).ended).toMatchObject({ reason: "carrier_closed" });
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...road.auth, inviteCode, now }))
      .toEqual({ ok: false, reason: "invite_not_found" });
    expect((await driverView(t, desk.auth, now)).ownsCarrierId).toBeNull();
  });

  test("a new invite code retires the old one", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, inviteCode } = await carrierWithDriver(t, now);
    const other = await player(t, OTHER, "Other Hand", now);
    const changed = await t.mutation(api.freightFateDispatch.updateCarrier, { ...desk.auth, newInviteCode: true, now });
    if (!changed.ok) throw new Error(changed.reason);
    expect(changed.inviteCode).not.toBe(inviteCode);
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...other.auth, inviteCode, now }))
      .toEqual({ ok: false, reason: "invite_not_found" });
    expect(await t.mutation(api.freightFateDispatch.joinCarrier, { ...other.auth, inviteCode: changed.inviteCode, now }))
      .toMatchObject({ ok: true, joined: true });
  });
});

describe("notes", () => {
  test("a note is heard once; a muted driver gets none; abusive text is refused", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "n1", memberDriverId: road.driverId, kind: "note",
      payload: { text: "  Watch the  scales on I-40. " }, now,
    });
    const mine = await driverView(t, road.auth, now);
    expect(mine.orders[0].payload).toEqual({ text: "Watch the scales on I-40." });
    // A note is heard, not accepted.
    expect(await t.mutation(api.freightFateDispatch.postReply, {
      ...road.auth, replyId: "h0", orderId: "n1", kind: "accepted", now,
    })).toEqual({ ok: false, reason: "wrong_order_kind" });
    await t.mutation(api.freightFateDispatch.postReply, { ...road.auth, replyId: "h1", orderId: "n1", kind: "heard", now });
    expect((await driverView(t, road.auth, now)).orders).toEqual([]);
    // Hearing it adds nothing for the desk to hear.
    expect((await deskView(t, desk.auth, now)).replies.map((r) => r.kind)).toEqual(["joined"]);

    await t.mutation(api.freightFateDispatch.setMySettings, { ...road.auth, notesMuted: true, now });
    expect(await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "n2", memberDriverId: road.driverId, kind: "note", payload: { text: "Hello" }, now,
    })).toEqual({ ok: false, reason: "notes_muted" });

    await t.mutation(api.freightFateDispatch.setMySettings, { ...road.auth, notesMuted: false, now });
    expect(await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "n3", memberDriverId: road.driverId, kind: "note", payload: { text: "you are a fucking idiot" }, now,
    })).toEqual({ ok: false, reason: "text_blocked", field: "text" });
  });
});

describe("account deletion", () => {
  test("deleting the dispatcher's account closes the carrier and releases its drivers", async () => {
    const t = setup();
    const now = Date.now();
    const { desk, road } = await carrierWithDriver(t, now);
    await t.mutation(api.freightFateDispatch.postOrder, {
      ...desk.auth, orderId: "o-x", memberDriverId: road.driverId, kind: "go_home", payload: { terminal: "Chicago, IL" }, now,
    });
    await t.run(async (ctx) => {
      const { purgeDriver } = await import("./accountDeletion");
      await purgeDriver(ctx, desk.driverId);
    });
    const mine = await driverView(t, road.auth, Date.now());
    expect(mine.carrier).toBeNull();
    expect(mine.orders).toEqual([]);
    expect(mine.ended).toMatchObject({ carrierName: "Owl Freight", reason: "carrier_closed" });
    const left = await t.run(async (ctx) => ({
      orders: await ctx.db.query("freightFateDispatchOrders").collect(),
      replies: await ctx.db.query("freightFateDispatchReplies").collect(),
    }));
    expect(left).toEqual({ orders: [], replies: [] });
  });
});
