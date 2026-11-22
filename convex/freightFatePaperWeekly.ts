// The paper's weekly job: every Monday, after the daily job, close the week
// that ended at midnight Eastern and write its edition. Run by
// runPaperSchedule in freightFatePaper.ts as three steps, so no single
// transaction reads more than a page of drivers:
//
//   beginWeek    opens the build (or finds the week already closed);
//   scanDrivers  one page of drivers per call: compares each nameable
//                driver's verified snapshot with their ledger row and leaves
//                a draft row with what it found;
//   finishWeek   turns the drafts and the week's tallies into stories,
//                publishes, and rolls the ledger forward.
//
// A week with fewer than three named stories publishes nothing and leaves
// the ledger where it was, so the next edition covers both weeks.
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  BEST_ON_TIME_MIN_LOADS,
  DELIVERY_MARKS,
  KIND_SLOTS,
  LANE_MIN_LOADS,
  MILE_MARKS,
  MIN_NAMED_STORIES,
  PAPER_PHRASES,
  RARE_ACHIEVEMENT_ONE_IN,
  STATE_MARKS,
  backPageFor,
  carrierKeyFromLabel,
  chooseVariant,
  crossedMark,
  easternDateKey,
  endorsementKeyFromLabel,
  knownCareerTitle,
  pickFrontPage,
  storyRank,
  truckKeyFromLabel,
  weekStartMs,
  type FactValue,
  type PaperStory,
} from "../lib/freight-fate-paper";
import {
  ensurePaperState,
  moveEdition,
  paperModeNow,
  paperNameable,
  refreshSinceMonday,
} from "./freightFatePaper";

type Ledger = Omit<Doc<"freightFatePaperLedger">, "_id" | "_creationTime">;
type Draft = Omit<Doc<"freightFatePaperDrafts">, "_id" | "_creationTime">;
type DriverTally = Doc<"freightFatePaperDriverTallies">;
type LoadFacts = NonNullable<DriverTally["longest"]>;
type Facts = Record<string, FactValue>;

export const SCAN_PAGE = 100;

export function ledgerFromSnapshot(
  driverId: string,
  snapshot: Doc<"freightFateProfileSnapshots">,
  now: number,
  lastFrontPageIssue?: number,
): Ledger {
  const safety = snapshot.safetyRecord;
  return {
    driverId,
    saveName: snapshot.sourceSaveName ?? snapshot.saveName ?? "",
    snapshotUpdatedAt: snapshot.updatedAt,
    ...(snapshot.sourceRevision === undefined ? {} : { sourceRevision: snapshot.sourceRevision }),
    deliveries: snapshot.deliveries,
    milesDriven: snapshot.milesDriven,
    onTimeDeliveries: snapshot.onTimeDeliveries ?? 0,
    level: snapshot.level,
    careerTitle: snapshot.careerTitle,
    ...(snapshot.carrierName === undefined ? {} : { carrierName: snapshot.carrierName }),
    ...(snapshot.businessStatus === undefined ? {} : { businessStatus: snapshot.businessStatus }),
    ...(snapshot.truckName === undefined ? {} : { truckName: snapshot.truckName }),
    ...(snapshot.truckIsCarrierAssigned === undefined ? {} : { truckIsCarrierAssigned: snapshot.truckIsCarrierAssigned }),
    endorsements: snapshot.endorsements ?? [],
    ...(snapshot.statesVisited === undefined ? {} : { statesVisited: snapshot.statesVisited }),
    ...(snapshot.citiesVisited === undefined ? {} : { citiesVisited: snapshot.citiesVisited }),
    ...(snapshot.lifetimeEarnings === undefined ? {} : { lifetimeEarnings: snapshot.lifetimeEarnings }),
    // Fatigue events stay out.
    ...(safety ? {
      safety: {
        citations: safety.citations,
        seriousViolations: safety.seriousViolations,
        majorOffenses: safety.majorOffenses,
        ...(safety.outOfServiceOrders === undefined ? {} : { outOfServiceOrders: safety.outOfServiceOrders }),
        ...(safety.crashes === undefined ? {} : { crashes: safety.crashes }),
        ...(safety.cargoClaims === undefined ? {} : { cargoClaims: safety.cargoClaims }),
        ...(safety.preventableEquipmentDamage === undefined
          ? {} : { preventableEquipmentDamage: safety.preventableEquipmentDamage }),
        carrierTerminations: safety.carrierTerminations,
        repossessions: safety.repossessions,
      },
    } : {}),
    ...(lastFrontPageIssue === undefined ? {} : { lastFrontPageIssue }),
    updatedAt: now,
  };
}

function loadFacts(load: LoadFacts | undefined, keys: Array<"cargo" | "origin" | "destination">): Facts {
  if (!load) return {};
  return {
    ...(keys.includes("cargo") && load.cargoKey ? { cargo: load.cargoKey } : {}),
    ...(keys.includes("origin") && load.originKey ? { origin: load.originKey } : {}),
    ...(keys.includes("destination") && load.destinationKey ? { destination: load.destinationKey } : {}),
  };
}

const ZERO_SAFETY = { citations: 0, outOfServiceOrders: 0, crashes: 0, cargoClaims: 0 };

function mergeTallies(tallies: DriverTally[]) {
  const ordered = [...tallies].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  let longest: LoadFacts | undefined;
  let heaviest: LoadFacts | undefined;
  for (const tally of ordered) {
    if ((tally.longest?.miles ?? 0) > (longest?.miles ?? 0)) longest = tally.longest;
    if ((tally.heaviest?.pounds ?? 0) > (heaviest?.pounds ?? 0)) heaviest = tally.heaviest;
  }
  return {
    deliveries: ordered.reduce((sum, tally) => sum + tally.deliveries, 0),
    firstDelivery: ordered.some((tally) => tally.firstDelivery),
    firstLoad: ordered.find((tally) => tally.firstDelivery)?.firstLoad ?? ordered.find((tally) => tally.firstLoad)?.firstLoad,
    longest,
    heaviest,
    achievements: [...new Set(ordered.flatMap((tally) => tally.achievements))],
  };
}

/**
 * One nameable driver's week: what the ledger needs now, and the draft the
 * finish step reads. Pure, so the rules can be tested without a backend.
 */
export function driverWeek(args: {
  driver: Doc<"freightFateDrivers">;
  snapshot: Doc<"freightFateProfileSnapshots"> | null;
  ledger: Doc<"freightFatePaperLedger"> | null;
  tallies: DriverTally[];
  weekKey: string;
  periodStart: number;
  periodEnd: number;
  now: number;
}): { ledgerWrite?: Ledger; draft?: Draft } {
  const { driver, ledger, weekKey, now } = args;
  const snapshot = args.snapshot?.sourceRevision && args.snapshot.validatorVersion ? args.snapshot : null;
  const merged = mergeTallies(args.tallies);
  const stories: Draft["stories"] = [];
  const newHire = driver.createdAt >= args.periodStart && driver.createdAt < args.periodEnd;
  const carrierKey = carrierKeyFromLabel(snapshot?.carrierName);
  const week: Draft["week"] = {
    ranked: true, tallyLoads: merged.deliveries, miles: 0, deliveries: 0, onTime: 0, newCities: 0,
    ...(carrierKey ? { carrierKey } : {}),
    ...(merged.longest ? { longest: merged.longest } : {}),
    ...(merged.heaviest ? { heaviest: merged.heaviest } : {}),
    safety: { ...ZERO_SAFETY },
  };

  if (merged.firstDelivery) {
    const load = merged.firstLoad;
    stories.push({
      kind: "first_delivery",
      facts: {
        ...loadFacts(load, ["cargo", "origin", "destination"]),
        ...(load?.miles ? { miles: load.miles } : {}),
        ...(carrierKey ? { carrier: carrierKey } : {}),
      },
    });
  }

  let ledgerWrite: Ledger | undefined;
  let ledgerNext: Ledger | undefined;
  const keepFront = ledger?.lastFrontPageIssue;
  if (snapshot && !ledger) {
    // The first week sets the baseline.
    ledgerWrite = ledgerFromSnapshot(driver.driverId, snapshot, now);
  } else if (snapshot && ledger) {
    const fresh = ledgerFromSnapshot(driver.driverId, snapshot, now, keepFront);
    if (ledger.saveName !== fresh.saveName) {
      // A different career: no rankings this week.
      ledgerWrite = fresh;
      week.ranked = false;
    } else if (snapshot.updatedAt > ledger.snapshotUpdatedAt) {
      const before = ledger;
      const safetyBefore = before.safety;
      const safetyAfter = fresh.safety;
      const diff = (a: number | undefined, b: number | undefined) => (b ?? 0) - (a ?? 0);
      const safetyDiff = {
        citations: diff(safetyBefore?.citations, safetyAfter?.citations),
        outOfServiceOrders: diff(safetyBefore?.outOfServiceOrders, safetyAfter?.outOfServiceOrders),
        crashes: diff(safetyBefore?.crashes, safetyAfter?.crashes),
        cargoClaims: diff(safetyBefore?.cargoClaims, safetyAfter?.cargoClaims),
      };
      const diffs = [
        diff(before.deliveries, fresh.deliveries),
        diff(before.milesDriven, fresh.milesDriven),
        diff(before.onTimeDeliveries, fresh.onTimeDeliveries),
        diff(before.level, fresh.level),
        diff(before.citiesVisited, fresh.citiesVisited),
        diff(before.statesVisited, fresh.statesVisited),
        diff(before.lifetimeEarnings, fresh.lifetimeEarnings),
        ...Object.values(safetyDiff),
      ];
      if (diffs.some((value) => value < 0)) {
        // Restored from an older backup: start again from here, no story.
        ledgerWrite = fresh;
        week.ranked = false;
      } else {
        ledgerNext = fresh;
        week.miles = Math.round(diff(before.milesDriven, fresh.milesDriven));
        week.deliveries = diff(before.deliveries, fresh.deliveries);
        week.onTime = diff(before.onTimeDeliveries, fresh.onTimeDeliveries);
        week.newCities = diff(before.citiesVisited, fresh.citiesVisited);
        week.safety = safetyDiff;

        if (fresh.careerTitle !== before.careerTitle && fresh.level > before.level
          && knownCareerTitle(fresh.careerTitle)) {
          stories.push({
            kind: "promotion",
            facts: { title: fresh.careerTitle, level: fresh.level, ...(carrierKey ? { carrier: carrierKey } : {}) },
          });
        }
        const mileMark = crossedMark(before.milesDriven, fresh.milesDriven, MILE_MARKS);
        if (mileMark) stories.push({ kind: "mile_club", facts: { mark: mileMark, deliveries: fresh.deliveries } });
        const deliveryMark = crossedMark(before.deliveries, fresh.deliveries, DELIVERY_MARKS);
        if (deliveryMark) {
          stories.push({
            kind: "delivery_club",
            facts: {
              mark: deliveryMark,
              ...(snapshot.onTimeRate === undefined ? {} : { rate: snapshot.onTimeRate }),
            },
          });
        }
        const stateMark = crossedMark(before.statesVisited ?? 0, fresh.statesVisited ?? 0, STATE_MARKS);
        if (stateMark) stories.push({ kind: "states_mark", facts: { mark: stateMark } });
        for (const label of fresh.endorsements) {
          if (before.endorsements.includes(label)) continue;
          const key = endorsementKeyFromLabel(label);
          if (key) stories.push({ kind: "endorsement", facts: { endorsement: key } });
        }

        const fromCarrier = carrierKeyFromLabel(before.carrierName);
        let businessStory = false;
        if (fresh.businessStatus !== before.businessStatus) {
          if (fresh.businessStatus === "leased_owner_operator" && carrierKey) {
            stories.push({ kind: "leased_on", facts: { carrier: carrierKey } });
            businessStory = true;
          } else if (fresh.businessStatus === "independent_authority") {
            stories.push({ kind: "own_authority", facts: fromCarrier ? { from_carrier: fromCarrier } : {} });
            businessStory = true;
          }
        } else if (carrierKey && fromCarrier && carrierKey !== fromCarrier
          && fresh.carrierName !== before.carrierName) {
          stories.push({ kind: "moved_carrier", facts: { carrier: carrierKey, from_carrier: fromCarrier } });
          businessStory = true;
        }
        const truckKey = truckKeyFromLabel(fresh.truckName);
        if (!businessStory && truckKey && fresh.truckName !== before.truckName) {
          if (fresh.truckIsCarrierAssigned && carrierKey) {
            stories.push({ kind: "new_truck_assigned", facts: { truck: truckKey, carrier: carrierKey } });
          } else if (!fresh.truckIsCarrierAssigned) {
            stories.push({ kind: "new_truck_owned", facts: { truck: truckKey } });
          }
        }
      }
    }
  }

  if (!week.ranked) {
    delete week.longest;
    delete week.heaviest;
  }
  const something = stories.length > 0 || newHire || merged.deliveries > 0
    || merged.achievements.length > 0 || ledgerNext !== undefined;
  if (!something) return ledgerWrite ? { ledgerWrite } : {};
  return {
    ...(ledgerWrite ? { ledgerWrite } : {}),
    draft: {
      weekKey,
      driverId: driver.driverId,
      stories,
      ...(newHire ? { newHire } : {}),
      week,
      achievements: merged.achievements,
      ...(keepFront === undefined ? {} : { lastFrontPageIssue: keepFront }),
      ...(ledgerNext ? { ledgerNext } : {}),
    },
  };
}

function closingWeek(now: number) {
  const periodEnd = weekStartMs(now);
  const start = weekStartMs(periodEnd - 1);
  return { weekKey: easternDateKey(start), weekStart: start, periodEnd };
}

async function deleteDrafts(ctx: MutationCtx, weekKey: string) {
  const rows = await ctx.db.query("freightFatePaperDrafts")
    .withIndex("by_week_driver", (q) => q.eq("weekKey", weekKey)).take(2000);
  for (const row of rows) await ctx.db.delete(row._id);
}

/** Tallies of weeks an edition already covered. Batched; the rest go next time. */
async function dropSpentTallies(ctx: MutationCtx, beforeKey: string) {
  const drivers = await ctx.db.query("freightFatePaperDriverTallies")
    .withIndex("by_week", (q) => q.lt("weekKey", beforeKey)).take(1000);
  for (const row of drivers) await ctx.db.delete(row._id);
  const weeks = await ctx.db.query("freightFatePaperWeekTallies")
    .withIndex("by_week", (q) => q.lt("weekKey", beforeKey)).take(50);
  for (const row of weeks) await ctx.db.delete(row._id);
}

export async function beginWeekRun(ctx: MutationCtx, now: number) {
  if (paperModeNow() === "off") return { status: "off" as const };
  const state = await ensurePaperState(ctx, now);
  const { weekKey, periodEnd } = closingWeek(now);
  if (state.lastClosedWeek !== undefined && state.lastClosedWeek >= weekKey) {
    return { status: "done" as const, weekKey };
  }
  if (state.build?.weekKey === weekKey) return { status: "building" as const, weekKey };
  if (state.build) await deleteDrafts(ctx, state.build.weekKey);
  const periodStart = state.periodStart ?? weekStartMs(periodEnd - 1);
  await dropSpentTallies(ctx, easternDateKey(periodStart));
  if (periodStart >= periodEnd) {
    // The paper started this week; there is no closed week yet.
    await ctx.db.patch(state._id, { lastClosedWeek: weekKey, build: undefined, updatedAt: now });
    return { status: "not_started" as const, weekKey };
  }
  await ctx.db.patch(state._id, {
    build: { weekKey, periodStart, periodEnd, cursor: null, done: false, nameable: 0, startedAt: now },
    updatedAt: now,
  });
  return { status: "building" as const, weekKey };
}

export const beginWeek = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => beginWeekRun(ctx, args.now),
});

export async function scanDriversRun(ctx: MutationCtx, now: number) {
  const state = await ensurePaperState(ctx, now);
  const build = state.build;
  if (!build) throw new Error("No paper build is open");
  if (build.done) return { done: true };
  const page = await ctx.db.query("freightFateDrivers")
    .paginate({ numItems: SCAN_PAGE, cursor: build.cursor });
  const fromKey = easternDateKey(build.periodStart);
  let nameable = build.nameable;
  for (const driver of page.page) {
    if (!paperNameable(driver)) continue;
    nameable += 1;
    const [snapshot, ledger, tallies] = await Promise.all([
      ctx.db.query("freightFateProfileSnapshots")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId)).unique(),
      ctx.db.query("freightFatePaperLedger")
        .withIndex("by_driver", (q) => q.eq("driverId", driver.driverId)).unique(),
      ctx.db.query("freightFatePaperDriverTallies")
        .withIndex("by_driver_week", (q) => q.eq("driverId", driver.driverId)
          .gte("weekKey", fromKey).lte("weekKey", build.weekKey))
        .take(60),
    ]);
    const result = driverWeek({
      driver, snapshot, ledger, tallies, weekKey: build.weekKey,
      periodStart: build.periodStart, periodEnd: build.periodEnd, now: now,
    });
    if (result.ledgerWrite) {
      if (ledger) await ctx.db.replace(ledger._id, result.ledgerWrite);
      else await ctx.db.insert("freightFatePaperLedger", result.ledgerWrite);
    }
    if (result.draft) {
      const existing = await ctx.db.query("freightFatePaperDrafts")
        .withIndex("by_week_driver", (q) => q.eq("weekKey", build.weekKey).eq("driverId", driver.driverId))
        .unique();
      if (existing) await ctx.db.replace(existing._id, result.draft);
      else await ctx.db.insert("freightFatePaperDrafts", result.draft);
    }
  }
  await ctx.db.patch(state._id, {
    build: { ...build, cursor: page.continueCursor, done: page.isDone, nameable },
    updatedAt: now,
  });
  return { done: page.isDone };
}

export const scanDrivers = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => scanDriversRun(ctx, args.now),
});

type NewStory = { kind: string; driverIds: string[]; facts: Facts };

function factsResolve(kind: string, facts: Facts) {
  const spec = PAPER_PHRASES.kinds[kind];
  const slots = KIND_SLOTS[kind];
  return spec.always.every((slot) => {
    const type = slots[slot];
    if (type === "driver" || type === "driverList") return true;
    return facts[slot] !== undefined;
  });
}

function topBy<T>(rows: T[], value: (row: T) => number, tie: (row: T) => string) {
  let best: T | undefined;
  for (const row of rows) {
    const score = value(row);
    if (score <= 0) continue;
    if (!best || score > value(best) || (score === value(best) && tie(row) < tie(best))) best = row;
  }
  return best;
}

export async function finishWeekRun(ctx: MutationCtx, now: number) {
  const mode = paperModeNow();
  if (mode === "off") return { status: "off" as const };
  const state = await ensurePaperState(ctx, now);
  const build = state.build;
  if (!build) return { status: "no_build" as const };
  if (!build.done) throw new Error("The paper's driver scan did not finish");
  const drafts = await ctx.db.query("freightFatePaperDrafts")
    .withIndex("by_week_driver", (q) => q.eq("weekKey", build.weekKey)).take(10_000);
  const fromKey = easternDateKey(build.periodStart);
  const weeks = await ctx.db.query("freightFatePaperWeekTallies")
    .withIndex("by_week", (q) => q.gte("weekKey", fromKey).lte("weekKey", build.weekKey)).take(60);
  const issue = state.lastIssue + 1;
  const stories: NewStory[] = [];
  const named = new Set(drafts.map((draft) => draft.driverId));

  // Driver news, from each driver's draft.
  for (const draft of drafts) {
    for (const story of draft.stories) stories.push({ kind: story.kind, driverIds: [draft.driverId], facts: story.facts });
  }
  const hires = drafts.filter((draft) => draft.newHire).map((draft) => draft.driverId).sort();
  if (hires.length > 0) stories.push({ kind: "new_hires", driverIds: hires, facts: { count: hires.length } });

  // Records.
  const ranked = drafts.filter((draft) => draft.week.ranked);
  const tie = (draft: Doc<"freightFatePaperDrafts">) => draft.driverId;
  const records: Array<{ record: string; driverId: string; value: number }> = [];
  let bestWeekMiles = state.bestWeekMiles;
  const mostMiles = topBy(ranked, (draft) => draft.week.miles, tie);
  if (mostMiles) {
    records.push({ record: "most_miles", driverId: mostMiles.driverId, value: mostMiles.week.miles });
    if (bestWeekMiles && mostMiles.week.miles > bestWeekMiles.miles) {
      stories.push({ kind: "record_week_miles", driverIds: [mostMiles.driverId], facts: { miles: mostMiles.week.miles } });
    } else {
      stories.push({
        kind: "most_miles", driverIds: [mostMiles.driverId],
        facts: { miles: mostMiles.week.miles, deliveries: mostMiles.week.deliveries },
      });
    }
    if (!bestWeekMiles || mostMiles.week.miles > bestWeekMiles.miles) {
      bestWeekMiles = { miles: mostMiles.week.miles, driverId: mostMiles.driverId, issue };
    }
  }
  // A one-load week or one new city is not a record anyone wants to read.
  const mostDeliveries = topBy(ranked.filter((draft) => draft.week.deliveries >= 2),
    (draft) => draft.week.deliveries, tie);
  if (mostDeliveries) {
    records.push({ record: "most_deliveries", driverId: mostDeliveries.driverId, value: mostDeliveries.week.deliveries });
    stories.push({ kind: "most_deliveries", driverIds: [mostDeliveries.driverId], facts: { count: mostDeliveries.week.deliveries } });
  }
  const bestOnTime = topBy(
    ranked.filter((draft) => draft.week.deliveries >= BEST_ON_TIME_MIN_LOADS && draft.week.onTime === draft.week.deliveries),
    (draft) => draft.week.deliveries, tie,
  );
  if (bestOnTime) {
    records.push({ record: "best_on_time", driverId: bestOnTime.driverId, value: bestOnTime.week.deliveries });
    stories.push({ kind: "best_on_time", driverIds: [bestOnTime.driverId], facts: { count: bestOnTime.week.deliveries } });
  }
  const longest = topBy(ranked, (draft) => draft.week.longest?.miles ?? 0, tie);
  if (longest) {
    const load = longest.week.longest!;
    records.push({ record: "longest_haul", driverId: longest.driverId, value: load.miles! });
    stories.push({
      kind: "longest_haul", driverIds: [longest.driverId],
      facts: { miles: load.miles!, ...loadFacts(load, ["cargo", "origin", "destination"]) },
    });
  }
  const heaviest = topBy(ranked, (draft) => draft.week.heaviest?.pounds ?? 0, tie);
  if (heaviest) {
    const load = heaviest.week.heaviest!;
    records.push({ record: "heaviest_load", driverId: heaviest.driverId, value: load.pounds! });
    stories.push({
      kind: "heaviest_load", driverIds: [heaviest.driverId],
      facts: { weight: load.pounds!, ...loadFacts(load, ["cargo", "origin", "destination"]) },
    });
  }
  const newCities = topBy(ranked.filter((draft) => draft.week.newCities >= 2), (draft) => draft.week.newCities, tie);
  if (newCities) {
    records.push({ record: "most_new_cities", driverId: newCities.driverId, value: newCities.week.newCities });
    stories.push({ kind: "most_new_cities", driverIds: [newCities.driverId], facts: { count: newCities.week.newCities } });
  }

  // Carrier standings: carriers with a driver who delivered, by miles.
  const carriers = new Map<string, { drivers: number; loads: number; miles: number; onTime: number }>();
  for (const draft of ranked) {
    if (draft.week.deliveries <= 0 || !draft.week.carrierKey) continue;
    const row = carriers.get(draft.week.carrierKey) ?? { drivers: 0, loads: 0, miles: 0, onTime: 0 };
    row.drivers += 1;
    row.loads += draft.week.deliveries;
    row.miles += draft.week.miles;
    row.onTime += draft.week.onTime;
    carriers.set(draft.week.carrierKey, row);
  }
  const standings = [...carriers.entries()]
    .map(([carrierKey, row]) => ({
      carrierKey, drivers: row.drivers, loads: row.loads, miles: row.miles,
      onTimeRate: Math.round(row.onTime * 1000 / row.loads) / 10,
    }))
    .sort((a, b) => b.miles - a.miles || a.carrierKey.localeCompare(b.carrierKey));

  // Freight, from the week's tallies. Totals only.
  const lanes = new Map<string, { originKey: string; destinationKey: string; count: number }>();
  const cargo = new Map<string, number>();
  let loads = 0;
  let miles = 0;
  let pounds = 0;
  for (const week of weeks) {
    loads += week.loads;
    miles += week.miles;
    pounds += week.pounds;
    for (const lane of week.lanes) {
      const key = `${lane.originKey}>${lane.destinationKey}`;
      const row = lanes.get(key) ?? { ...lane, count: 0 };
      row.count += lane.count;
      lanes.set(key, row);
    }
    for (const row of week.cargo) cargo.set(row.key, (cargo.get(row.key) ?? 0) + row.count);
  }
  const busiest = topBy([...lanes.values()].filter((lane) => lane.count >= LANE_MIN_LOADS),
    (lane) => lane.count, (lane) => `${lane.originKey}>${lane.destinationKey}`);
  if (busiest) {
    stories.push({
      kind: "busiest_lane", driverIds: [],
      facts: { origin: busiest.originKey, destination: busiest.destinationKey, count: busiest.count },
    });
  }
  const topCargo = topBy([...cargo.entries()], ([, count]) => count, ([key]) => key);
  if (topCargo) stories.push({ kind: "top_cargo", driverIds: [], facts: { cargo: topCargo[0], count: topCargo[1] } });
  const tons = Math.round(pounds / 2000);
  if (tons > 0) stories.push({ kind: "tons_total", driverIds: [], facts: { tons } });
  const deliveringDrivers = drafts.filter((draft) => draft.week.tallyLoads > 0).length;
  if (loads > 0) {
    stories.push({ kind: "week_totals", driverIds: [], facts: { drivers: deliveringDrivers, loads, miles } });
  }

  // Blotter: counts only, never a driver.
  const blotter = { citations: 0, outOfServiceOrders: 0, crashes: 0, cargoClaims: 0 };
  for (const draft of ranked) {
    for (const key of Object.keys(blotter) as Array<keyof typeof blotter>) blotter[key] += draft.week.safety[key];
  }
  const blotterKinds = {
    citations: "blotter_citations", outOfServiceOrders: "blotter_out_of_service",
    crashes: "blotter_crashes", cargoClaims: "blotter_cargo_claims",
  } as const;
  for (const [key, kind] of Object.entries(blotterKinds)) {
    const count = blotter[key as keyof typeof blotter];
    if (count > 0) stories.push({ kind, driverIds: [], facts: { count } });
  }

  // On the dial: stations accepted in the period.
  const stationNews = await ctx.db.query("freightFateStationNews")
    .withIndex("by_created", (q) => q.gte("createdAt", build.periodStart).lt("createdAt", build.periodEnd))
    .take(50);
  const stationNames = stationNews.flatMap((news) => news.stations.map((station) => station.name))
    .map((name) => name.replace(/[{}]/g, "").trim()).filter(Boolean).slice(0, 40);
  if (stationNames.length > 0) {
    stories.push({ kind: "stations_added", driverIds: [], facts: { count: stationNames.length, stations: stationNames } });
  }

  // Firsts into a city.
  const firsts = await ctx.db.query("freightFatePaperFirsts")
    .withIndex("by_reported", (q) => q.eq("reported", false).lt("firstAt", build.periodEnd)).take(200);
  for (const first of firsts) {
    if (!first.driverId || !named.has(first.driverId)) continue;
    stories.push({
      kind: "first_into_city", driverIds: [first.driverId],
      facts: {
        city: first.cityKey,
        ...loadFacts(first.load, ["cargo", "origin"]),
        ...(first.load?.miles ? { miles: first.load.miles } : {}),
      },
    });
  }

  // Rare achievements: held by fewer than one nameable driver in twenty.
  const holders = new Map<string, number>();
  const enough = Math.max(1, Math.ceil(build.nameable / RARE_ACHIEVEMENT_ONE_IN));
  for (const draft of drafts) {
    for (const key of draft.achievements) {
      if (!holders.has(key)) {
        const rows = await ctx.db.query("freightFateAchievements")
          .withIndex("by_achievement", (q) => q.eq("achievementKey", key)).take(enough);
        holders.set(key, rows.length);
      }
      const count = holders.get(key)!;
      if (count * RARE_ACHIEVEMENT_ONE_IN < build.nameable) {
        stories.push({ kind: "rare_achievement", driverIds: [draft.driverId], facts: { achievement: key, holders: count } });
      }
    }
  }

  // Finish each story: id, wording, rank, section.
  const finished: PaperStory[] = [];
  const ids = new Map<string, number>();
  for (const story of stories) {
    if (!PAPER_PHRASES.kinds[story.kind] || !factsResolve(story.kind, story.facts)) continue;
    const base = `${story.kind}.${story.driverIds.length === 1 ? story.driverIds[0] : "all"}`;
    const seen = (ids.get(base) ?? 0) + 1;
    ids.set(base, seen);
    finished.push({
      id: seen === 1 ? base : `${base}.${seen}`,
      section: PAPER_PHRASES.kinds[story.kind].section,
      kind: story.kind,
      driverIds: story.driverIds,
      facts: story.facts,
      variant: chooseVariant(story.kind, issue, story.driverIds, story.facts),
      rank: storyRank(story.kind, story.facts),
    });
  }

  const namedStories = finished.filter((story) => story.driverIds.length > 0).length;
  if (namedStories < MIN_NAMED_STORIES) {
    // Thin: publish nothing; the ledger stays, the week folds into the next.
    await deleteDrafts(ctx, build.weekKey);
    await ctx.db.patch(state._id, { build: undefined, lastClosedWeek: build.weekKey, updatedAt: now });
    return { status: "thin" as const, weekKey: build.weekKey, namedStories };
  }

  const lastFront = new Map(drafts.flatMap((draft) =>
    draft.lastFrontPageIssue === undefined ? [] : [[draft.driverId, draft.lastFrontPageIssue] as const]));
  const front = pickFrontPage(finished, lastFront);
  const frontIds = new Set(front.map((story) => story.id));
  const sectionOrder = Object.keys(PAPER_PHRASES.sections);
  const ordered = [
    ...front.map((story) => ({ ...story, section: "front_page" })),
    ...finished.filter((story) => !frontIds.has(story.id))
      .sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
        || b.rank - a.rank || a.id.localeCompare(b.id)),
  ];

  const editionId = await ctx.db.insert("freightFatePaperEditions", {
    issue,
    weekKey: build.weekKey,
    periodStart: build.periodStart,
    periodEnd: build.periodEnd,
    state: "building",
    builtAt: now,
    stories: ordered,
    records,
    standings,
    backPage: backPageFor(issue),
  });
  await moveEdition(ctx, (await ctx.db.get(editionId))!, mode === "on" ? "finish_public" : "finish_preview", now);

  const frontDrivers = new Set(front.flatMap((story) => story.driverIds));
  for (const draft of drafts) {
    if (!draft.ledgerNext && !frontDrivers.has(draft.driverId)) continue;
    const ledger = await ctx.db.query("freightFatePaperLedger")
      .withIndex("by_driver", (q) => q.eq("driverId", draft.driverId)).unique();
    const lastFrontPageIssue = frontDrivers.has(draft.driverId) ? issue : draft.lastFrontPageIssue;
    if (draft.ledgerNext) {
      const next = { ...draft.ledgerNext, ...(lastFrontPageIssue === undefined ? {} : { lastFrontPageIssue }) };
      if (ledger) await ctx.db.replace(ledger._id, next);
      else await ctx.db.insert("freightFatePaperLedger", next);
    } else if (ledger) {
      await ctx.db.patch(ledger._id, { lastFrontPageIssue: issue });
    }
  }
  for (const first of firsts) await ctx.db.patch(first._id, { reported: true, issue });
  await deleteDrafts(ctx, build.weekKey);
  await ctx.db.patch(state._id, {
    lastIssue: issue,
    lastClosedWeek: build.weekKey,
    periodStart: build.periodEnd,
    build: undefined,
    ...(bestWeekMiles ? { bestWeekMiles } : {}),
    updatedAt: now,
  });
  await dropSpentTallies(ctx, easternDateKey(build.periodEnd));
  await refreshSinceMonday(ctx, now);
  return { status: "published" as const, issue, stories: ordered.length, namedStories };
}

export const finishWeek = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => finishWeekRun(ctx, args.now),
});
