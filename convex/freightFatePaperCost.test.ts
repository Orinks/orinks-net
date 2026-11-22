/// <reference types="vite/client" />
// What the paper's jobs read, against a seeded set of 450 drivers. Every
// document a job's database calls hand back is counted at its JSON size, the
// same order of size the backend bills reads by. The bounds are generous;
// the printed numbers are the measurement (n1-report.md).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type { MutationCtx } from "./_generated/server";
import { SHARING_CONSENT_VERSION } from "./freightFate";
import { renderEdition, runDailyBatch, seedFirstsRun } from "./freightFatePaper";
import { beginWeekRun, finishWeekRun, scanDriversRun } from "./freightFatePaperWeekly";
import { ALL_LINES } from "../lib/freight-fate-invariants";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60_000;
const DRIVERS = 450;
const EVENTS_PER_DAY = 300;
const LONG_AGO = Date.UTC(2026, 9, 1, 12);
const FIRST_RUN = Date.UTC(2026, 10, 3, 17);
const MON1 = Date.UTC(2026, 10, 9, 12);
const MON2 = Date.UTC(2026, 10, 16, 12);

type Meter = { docs: number; bytes: number };

function count(meter: Meter, value: unknown) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) count(meter, item);
    return;
  }
  if (typeof value === "object" && "page" in (value as object) && "isDone" in (value as object)) {
    count(meter, (value as { page: unknown[] }).page);
    return;
  }
  meter.docs += 1;
  meter.bytes += JSON.stringify(value).length;
}

function meteredQuery(query: object, meter: Meter): unknown {
  return new Proxy(query, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      if (prop === Symbol.asyncIterator) {
        return () => {
          const iterator = value.call(target);
          return {
            async next() {
              const result = await iterator.next();
              if (!result.done) count(meter, result.value);
              return result;
            },
            [Symbol.asyncIterator]() { return this; },
          };
        };
      }
      return (...args: unknown[]) => {
        const out = value.apply(target, args);
        if (out && typeof (out as Promise<unknown>).then === "function") {
          return (out as Promise<unknown>).then((result) => {
            count(meter, result);
            return result;
          });
        }
        return meteredQuery(out as object, meter);
      };
    },
  });
}

function metered(ctx: MutationCtx, meter: Meter): MutationCtx {
  const db = new Proxy(ctx.db, {
    get(target, prop) {
      if (prop === "query") return (table: string) => meteredQuery((target.query as (t: string) => object)(table), meter);
      if (prop === "get") {
        return async (id: never) => {
          const doc = await target.get(id);
          count(meter, doc);
          return doc;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...ctx, db } as MutationCtx;
}

const cityKeys = Object.keys(ALL_LINES.cityLabels);
const label = (key: string) => ALL_LINES.cityLabels[key];
const places = (seed: number) => {
  const byState = new Map<string, string[]>();
  for (let index = 0; index < 30; index += 1) {
    const text = label(cityKeys[(seed * 7 + index * 13) % cityKeys.length]);
    const comma = text.lastIndexOf(", ");
    const state = text.slice(comma + 2);
    byState.set(state, [...(byState.get(state) ?? []), text.slice(0, comma)]);
  }
  return [...byState.entries()].map(([state, cities]) => ({ state, cities }));
};

function snapshot(driverId: string, index: number, time: number, grow: number) {
  return {
    driverId, version: 1, saveName: "Main career", sourceSaveName: "Main career",
    businessStatus: "company_driver" as const, businessIdentity: "Company driver for Northstar Freight Lines",
    carrierName: index % 2 ? "Northstar Freight Lines" : "Prairie Link Regional",
    level: 4 + Math.floor(grow / 4), careerTitle: "Regional Company Driver", lastSavedCity: "Chicago, Illinois",
    deliveries: 50 + index + grow * 5, milesDriven: 40_000 + index * 100 + grow * 2_500, reputation: 60,
    onTimeDeliveries: 45 + index + grow * 5, onTimeRate: 95, damageFreeDeliveries: 40, damageFreeRate: 90,
    truckName: "aero cruiser", truckIsCarrierAssigned: true, employmentStatus: "Company driver",
    lifetimeEarnings: 100_000 + grow * 9_000, citiesVisited: 30, statesVisited: 12, visitedPlaces: places(index),
    longestHaulMiles: 1_800,
    safetyRecord: {
      citations: grow, seriousViolations: 0, majorOffenses: 0, outOfServiceOrders: 0, crashes: 0,
      fatigueEvents: 2, cargoClaims: 0, preventableEquipmentDamage: 0, carrierTerminations: 0, repossessions: 0,
    },
    netWorth: 50_000, netWorthComplete: true, badgesEarned: 12,
    endorsements: ["flatbed securement", "refrigerated"], fleetTier: "Standard",
    capturedAt: time, updatedAt: time, sourceRevision: 10 + grow, validatorVersion: 1, meaningfulPlayedAt: time,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("FREIGHT_FATE_PAPER", "on");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("one daily run and one weekly run against 450 drivers", async () => {
  const t = convexTest(schema, modules);
  vi.setSystemTime(LONG_AGO);
  await t.run(async (ctx) => {
    for (let index = 0; index < DRIVERS; index += 1) {
      const driverId = `driver-${index}`;
      await ctx.db.insert("freightFateDrivers", {
        driverId, displayName: `Driver Number ${index}`, authSubject: `user_${index}`,
        // About one in ten has Profile sharing off, as on 2026-11-15.
        visibility: index % 10 === 0 ? "private" : "public",
        sharingConsentVersion: index % 10 === 0 ? undefined : SHARING_CONSENT_VERSION,
        lastClientVersion: "v1.9.7", createdAt: LONG_AGO, updatedAt: LONG_AGO,
      });
      await ctx.db.insert("freightFateProfileSnapshots", snapshot(driverId, index, LONG_AGO, 0));
    }
  });

  const seedMeter: Meter = { docs: 0, bytes: 0 };
  vi.setSystemTime(FIRST_RUN);
  for (let page = 0; page < 20; page += 1) {
    if ((await t.run((ctx) => seedFirstsRun(metered(ctx, seedMeter), FIRST_RUN))).done) break;
  }

  // The baseline week (not measured): ledgers written, nothing published.
  await t.run((ctx) => beginWeekRun(ctx, MON1));
  for (let page = 0; page < 20; page += 1) if ((await t.run((ctx) => scanDriversRun(ctx, MON1))).done) break;
  await t.run((ctx) => finishWeekRun(ctx, MON1));

  // Seven days of deliveries, then every driver backs up a bigger career.
  let eventId = 0;
  const postDay = async (day: number) => {
    for (let index = 0; index < EVENTS_PER_DAY; index += 1) {
      const time = MON1 + day * DAY + index * 1_000;
      vi.setSystemTime(time);
      const driverId = `driver-${(index * 37 + day) % DRIVERS}`;
      const origin = label(cityKeys[(index * 11) % cityKeys.length]);
      const destination = label(cityKeys[(index * 17 + 3) % cityKeys.length]);
      eventId += 1;
      await t.run(async (ctx) => {
        await ctx.db.insert("freightFateDriverEvents", {
          driverId, eventId: `delivery-${eventId}-${driverId}`, eventType: "delivery_completed",
          summary: `steel coils, 40,000 pounds, delivered from ${origin} to ${destination} over 800 miles on time.`,
          payloadVersion: 1,
          payload: {
            version: 1, cargo: "steel coils", weightPounds: 40_000, origin, destination,
            distanceMiles: 800, onTime: true,
          },
          occurredAt: time, createdAt: time,
        });
      });
    }
  };
  for (let day = 0; day < 6; day += 1) {
    await postDay(day);
    await t.run(async (ctx) => {
      for (let batch = 0; batch < 20; batch += 1) {
        if ((await runDailyBatch(ctx, MON1 + day * DAY + 20 * 60 * 60_000)).done) break;
      }
    });
  }
  await postDay(6);
  vi.setSystemTime(MON2 - DAY);
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("freightFateProfileSnapshots").collect();
    for (const [index, row] of rows.entries()) await ctx.db.replace(row._id, snapshot(row.driverId, index, MON2 - DAY, 1));
  });

  vi.setSystemTime(MON2);
  const dailyMeter: Meter = { docs: 0, bytes: 0 };
  await t.run(async (ctx) => {
    for (let batch = 0; batch < 20; batch += 1) {
      if ((await runDailyBatch(metered(ctx, dailyMeter), MON2)).done) break;
    }
  });
  const weeklyMeter: Meter = { docs: 0, bytes: 0 };
  await t.run((ctx) => beginWeekRun(metered(ctx, weeklyMeter), MON2));
  for (let page = 0; page < 20; page += 1) {
    if ((await t.run((ctx) => scanDriversRun(metered(ctx, weeklyMeter), MON2))).done) break;
  }
  const status = await t.run((ctx) => finishWeekRun(metered(ctx, weeklyMeter), MON2));
  expect(status).toMatchObject({ status: "published", issue: 1 });

  const readMeter: Meter = { docs: 0, bytes: 0 };
  await t.run(async (ctx) => {
    const db = metered(ctx, readMeter);
    const edition = await db.db.query("freightFatePaperEditions").withIndex("by_issue", (q) => q.eq("issue", 1)).unique();
    await renderEdition(db, edition!);
  });

  const kb = (meter: Meter) => `${meter.docs} documents, ${Math.round(meter.bytes / 1024)} KB`;
  console.log(`PAPER COST seed (once ever): ${kb(seedMeter)}`);
  console.log(`PAPER COST daily run, ${EVENTS_PER_DAY} events: ${kb(dailyMeter)}`);
  console.log(`PAPER COST weekly run, ${DRIVERS} drivers: ${kb(weeklyMeter)}`);
  console.log(`PAPER COST one edition read: ${kb(readMeter)}`);
  expect(dailyMeter.bytes).toBeLessThan(1024 * 1024);
  expect(weeklyMeter.bytes).toBeLessThan(6 * 1024 * 1024);
  expect(readMeter.bytes).toBeLessThan(64 * 1024);
}, 120_000);
