#!/usr/bin/env node
// Plays both sides of a live-dispatch run against a real deployment, so the
// server can be checked before either game speaks the protocol.
//
//   FF_SITE=https://orinks.net \
//   DESK_DRIVER_ID=... DESK_TOKEN=ffd_... \
//   ROAD_DRIVER_ID=... ROAD_TOKEN=ffd_... \
//   node scripts/fake-dispatch-driver.mjs
//
// Both drivers must be named in FREIGHT_FATE_LIVE_DISPATCH on that Convex
// deployment (or the flag set to "on"). The desk account opens a carrier if it
// has none; the road account joins it, signs on empty in Gary, takes a load to
// Dallas, delivers it late and leaves. Every step prints what came back. Run
// with --stay to leave the road driver in the carrier for the night desk.

const site = (process.env.FF_SITE ?? "https://orinks.net").replace(/\/+$/, "");
const desk = { driverId: process.env.DESK_DRIVER_ID, token: process.env.DESK_TOKEN };
const road = { driverId: process.env.ROAD_DRIVER_ID, token: process.env.ROAD_TOKEN };
const stay = process.argv.includes("--stay");

if (!desk.driverId || !desk.token || !road.driverId || !road.token) {
  console.error("Set DESK_DRIVER_ID, DESK_TOKEN, ROAD_DRIVER_ID and ROAD_TOKEN.");
  process.exit(2);
}

async function call(who, method, path, body) {
  const url = new URL(`${site}/api/freight-fate${path}`);
  if (method === "GET") url.searchParams.set("driverId", who.driverId);
  const reply = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${who.token}`,
      "content-type": "application/json",
      "user-agent": "FreightFate/fake-dispatch-driver",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify({ driverId: who.driverId, ...body }) }),
  });
  const json = await reply.json().catch(() => ({}));
  console.log(`${method} ${path} -> ${reply.status}`, JSON.stringify(json));
  if (!reply.ok) throw new Error(`${method} ${path} failed`);
  return json;
}

const run = Date.now().toString(36);

const carrier = await call(desk, "POST", "/dispatch/carrier", {
  name: "Fake Driver Test Freight",
  homeTerminal: "Chicago, IL",
  lanes: [{ origin: "Gary, IN", destination: "Dallas, TX", cargo: "Steel coils" }],
});
const mine = await call(road, "GET", "/dispatch");
if (!mine.carrier) await call(road, "POST", "/dispatch/join", { inviteCode: carrier.inviteCode });

await call(road, "POST", "/presence", {
  activity: "At the yard",
  detail: "Gary, IN",
  truck: { city: "Gary, IN", hosMinutesLeft: 600, fuelPercent: 80, loaded: false },
});
await call(road, "POST", "/dispatch/replies", { replyId: `fake-${run}-on`, kind: "signed_on" });

const orderId = `fake-${run}-load`;
await call(desk, "POST", "/dispatch/orders", {
  orderId,
  memberDriverId: road.driverId,
  kind: "load_offer",
  payload: {
    jobSeed: run,
    origin: "Gary, IN",
    destination: "Dallas, TX",
    cargo: "Steel coils",
    appointment: "Thursday 2 PM",
    routeName: "I-57 to I-30",
    fuelStop: "Effingham, IL",
  },
});
await call(road, "POST", "/presence", { activity: "At the yard", detail: "Gary, IN" });
await call(road, "GET", "/dispatch");
await call(road, "POST", "/dispatch/replies", { replyId: `fake-${run}-ok`, orderId, kind: "accepted" });
await call(road, "POST", "/presence", {
  activity: "Driving",
  detail: "I-57 south",
  truck: { city: "Effingham, IL", nextWaypoint: "Memphis, TN", hosMinutesLeft: 380, fuelPercent: 55, cargo: "Steel coils", loaded: true },
});
await call(road, "POST", "/dispatch/replies", {
  replyId: `fake-${run}-done`,
  orderId,
  kind: "delivered",
  payload: { onTime: false, minutesLate: 45, lateReason: "Weigh station in Arkansas", miles: 933 },
});

const view = await call(desk, "GET", "/dispatch/carrier");
await call(desk, "PATCH", "/dispatch/replies", { replyIds: view.replies.map((reply) => reply.replyId) });

if (!stay) await call(road, "POST", "/dispatch/leave", {});
await call(road, "POST", "/presence", { activity: "", detail: "" });
console.log("Fake driver run finished.");
