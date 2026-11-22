/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { SHARING_CONSENT_VERSION } from "./freightFate";
import { PAPER_SHARING_CONSENT_VERSION, paperNameable } from "./freightFatePaper";
import { purgeDriver } from "./accountDeletion";

const modules = import.meta.glob("./**/*.ts");

// Eastern time: daylight time ends Sunday 2026-11-01, so these weeks are EST.
// The paper's week starts Monday 00:00 Eastern, 05:00 UTC.
const LONG_AGO = Date.UTC(2026, 9, 1, 12);
const FIRST_RUN = Date.UTC(2026, 10, 3, 17); // Tue Nov 3
const WEEK1_EVENT = Date.UTC(2026, 10, 5, 18); // Thu Nov 5
const MON1 = Date.UTC(2026, 10, 9, 12); // closes Nov 2-9
const WEEK2 = Date.UTC(2026, 10, 11, 15); // Wed Nov 11
const SNAP2 = Date.UTC(2026, 10, 15, 20); // Sun Nov 15
const MON2 = Date.UTC(2026, 10, 16, 12); // closes Nov 9-16
const WEEK3 = Date.UTC(2026, 10, 18, 15);
const SNAP3 = Date.UTC(2026, 10, 22, 20);
const MON3 = Date.UTC(2026, 10, 23, 12);
const ADMIN = { subject: "owner", email: "owner@example.com", emailVerified: true };

type T = ReturnType<typeof setup>;

function setup() {
  return convexTest(schema, modules);
}

async function at<R>(time: number, run: () => Promise<R>) {
  vi.setSystemTime(time);
  return run();
}

async function addDriver(t: T, driverId: string, displayName: string, extra: Partial<Doc<"freightFateDrivers">> = {}) {
  await at(extra.createdAt ?? LONG_AGO, () => t.run(async (ctx) => {
    await ctx.db.insert("freightFateDrivers", {
      driverId, displayName, authSubject: `user_${driverId}`, visibility: "public",
      sharingConsentVersion: SHARING_CONSENT_VERSION, createdAt: LONG_AGO, updatedAt: LONG_AGO, ...extra,
    });
  }));
}

type SnapFields = Partial<Doc<"freightFateProfileSnapshots">>;

async function setSnapshot(t: T, driverId: string, time: number, fields: SnapFields) {
  await at(time, () => t.run(async (ctx) => {
    const existing = await ctx.db.query("freightFateProfileSnapshots")
      .withIndex("by_driver", (q) => q.eq("driverId", driverId)).unique();
    const base = existing ? { ...existing, _id: undefined, _creationTime: undefined } : {
      driverId, version: 1, saveName: "Main career", sourceSaveName: "Main career",
      level: 3, careerTitle: "Solo Company Driver", deliveries: 10, milesDriven: 5_000,
      reputation: 50, onTimeDeliveries: 10, carrierName: "Northstar Freight Lines",
      businessStatus: "company_driver" as const, truckName: "aero cruiser", truckIsCarrierAssigned: true,
      endorsements: [], citiesVisited: 2, statesVisited: 2, lifetimeEarnings: 10_000,
      safetyRecord: {
        citations: 0, seriousViolations: 0, majorOffenses: 0, fatigueEvents: 0,
        carrierTerminations: 0, repossessions: 0, crashes: 0, outOfServiceOrders: 0, cargoClaims: 0,
      },
      capturedAt: time, validatorVersion: 1,
    };
    const row = {
      ...base, ...fields, updatedAt: time,
      sourceRevision: ((existing?.sourceRevision ?? 0) + 1),
    } as Doc<"freightFateProfileSnapshots">;
    delete (row as Partial<typeof row>)._id;
    delete (row as Partial<typeof row>)._creationTime;
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("freightFateProfileSnapshots", row);
  }));
}

let eventCounter = 0;
async function deliver(t: T, driverId: string, time: number, load: {
  cargo?: string; origin: string; destination: string; miles: number; pounds: number; onTime?: boolean;
  version?: 2; keys?: { cargoKey: string; originKey: string; destinationKey: string };
}) {
  eventCounter += 1;
  await at(time, () => t.run(async (ctx) => {
    await ctx.db.insert("freightFateDriverEvents", {
      driverId, eventId: `e${eventCounter}`, eventType: "delivery_completed", summary: "x",
      payloadVersion: load.version ?? 1,
      payload: {
        version: load.version ?? 1, cargo: load.cargo ?? "steel coils", weightPounds: load.pounds,
        origin: load.origin, destination: load.destination, distanceMiles: load.miles,
        onTime: load.onTime ?? true, notableCondition: "NOTABLE-NOTE",
        ...(load.keys ?? {}),
      },
      occurredAt: time, createdAt: time,
    });
  }));
}

async function run(t: T, time: number, weekly?: boolean) {
  return at(time, () => t.action(internal.freightFatePaper.runPaperSchedule, {
    now: time, ...(weekly === undefined ? {} : { weekly }),
  }));
}

async function edition(t: T, issue?: number, identity?: typeof ADMIN) {
  const reader = identity ? t.withIdentity(identity) : t;
  return reader.query(api.freightFatePaper.getEdition, issue === undefined ? {} : { issue });
}

async function patchDriver(t: T, driverId: string, fields: Partial<Doc<"freightFateDrivers">>) {
  await t.run(async (ctx) => {
    const driver = await ctx.db.query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driverId)).unique();
    await ctx.db.patch(driver!._id, fields);
  });
}

const PAPER_TABLES = [
  "freightFatePaperState", "freightFatePaperLedger", "freightFatePaperDriverTallies",
  "freightFatePaperWeekTallies", "freightFatePaperEditions", "freightFatePaperIssues",
  "freightFatePaperFirsts", "freightFatePaperDrafts",
] as const;

async function dump(t: T) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of PAPER_TABLES) out[table] = await ctx.db.query(table).collect();
    return out;
  });
}

const HIDDEN = ["carol-off", "dan-guest", "erin-flagged", "frank-masked"];

/**
 * Two weeks of a small world: a thin first week (baselines, one heavy load),
 * then a full week that publishes issue 1 covering both.
 */
async function buildWorld(mode = "on") {
  vi.stubEnv("FREIGHT_FATE_PAPER", mode);
  const t = setup();
  await addDriver(t, "alice", "Alice Hauler");
  await addDriver(t, "bob", "Bob Freight");
  await addDriver(t, "carol-off", "Carol Private", { visibility: "private", sharingConsentVersion: undefined });
  await addDriver(t, "dan-guest", "Dan Guest", { guest: true, authSubject: undefined });
  await addDriver(t, "erin-flagged", "Erin Flagged", { integrityFlag: "impossible_money" });
  await addDriver(t, "frank-masked", "Hitler Hauler");
  await addDriver(t, "hank", "Hank Steady");
  await setSnapshot(t, "alice", LONG_AGO, {
    level: 5, careerTitle: "Regional Company Driver", deliveries: 95, milesDriven: 99_500, onTimeDeliveries: 90,
    visitedPlaces: [{ state: "Illinois", cities: ["Chicago"] }, { state: "Texas", cities: ["Dallas"] }],
  });
  await setSnapshot(t, "bob", LONG_AGO, { deliveries: 40, milesDriven: 50_000, onTimeDeliveries: 30 });
  await setSnapshot(t, "hank", LONG_AGO, { deliveries: 20, milesDriven: 8_000, onTimeDeliveries: 20 });
  for (const hidden of HIDDEN) {
    await setSnapshot(t, hidden, LONG_AGO, { deliveries: 1, milesDriven: 100, onTimeDeliveries: 1 });
  }

  await run(t, FIRST_RUN);
  await deliver(t, "bob", WEEK1_EVENT, { origin: "Gary", destination: "Dallas, Texas", miles: 1_500, pounds: 80_000 });
  const week1 = await run(t, MON1);
  expect((week1.weekly as { status: string }).status).toBe("thin");

  await addDriver(t, "gina-new", "Gina Rookie", { createdAt: WEEK2 });
  await setSnapshot(t, "gina-new", WEEK2, { deliveries: 0, milesDriven: 0, onTimeDeliveries: 0 });
  for (let load = 0; load < 6; load += 1) {
    await deliver(t, "alice", WEEK2 + load * 60_000, {
      origin: "Chicago, Illinois", destination: "Dallas, Texas", miles: 900, pounds: 40_000,
    });
  }
  await deliver(t, "alice", WEEK2 + 10 * 60_000, { origin: "Dallas, Texas", destination: "Omaha, Nebraska", miles: 650, pounds: 30_000 });
  await deliver(t, "bob", WEEK2 + 20 * 60_000, { origin: "Atlantis, Nowhere", destination: "Dallas, Texas", miles: 2_400, pounds: 30_000 });
  await deliver(t, "carol-off", WEEK2, { origin: "Chicago, Illinois", destination: "Memphis, Tennessee", miles: 9_000, pounds: 150_000 });
  await deliver(t, "erin-flagged", WEEK2, { origin: "Chicago, Illinois", destination: "Denver, Colorado", miles: 8_000, pounds: 150_000 });
  await deliver(t, "frank-masked", WEEK2, { origin: "Chicago, Illinois", destination: "Denver, Colorado", miles: 8_000, pounds: 150_000 });
  await run(t, WEEK2 + DAY);
  await setSnapshot(t, "alice", SNAP2, {
    level: 6, careerTitle: "Regional Regular", deliveries: 102, milesDriven: 100_400, onTimeDeliveries: 97,
    citiesVisited: 3,
    safetyRecord: {
      citations: 1, seriousViolations: 0, majorOffenses: 0, fatigueEvents: 4,
      carrierTerminations: 0, repossessions: 0, crashes: 0, outOfServiceOrders: 0, cargoClaims: 0,
    },
  });
  await setSnapshot(t, "bob", SNAP2, { deliveries: 44, milesDriven: 54_000, onTimeDeliveries: 33 });
  for (const hidden of HIDDEN) {
    await setSnapshot(t, hidden, SNAP2, { deliveries: 900, milesDriven: 900_000, onTimeDeliveries: 900 });
  }
  const week2 = await run(t, MON2);
  return { t, week2 };
}

const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("GAMES_ADMIN_EMAILS", ADMIN.email);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("who can be named", () => {
  test("the paper's consent version is the site's", () => {
    expect(PAPER_SHARING_CONSENT_VERSION).toBe(SHARING_CONSENT_VERSION);
  });

  test("guests, sharing off, flagged, masked and pending renames are not nameable", () => {
    const base = {
      driverId: "x", displayName: "Rig Hauler", authSubject: "u", visibility: "public",
      sharingConsentVersion: SHARING_CONSENT_VERSION, createdAt: 0, updatedAt: 0,
    } as Doc<"freightFateDrivers">;
    expect(paperNameable(base)).toBe(true);
    expect(paperNameable({ ...base, guest: true })).toBe(false);
    expect(paperNameable({ ...base, visibility: "unlisted" })).toBe(false);
    expect(paperNameable({ ...base, sharingConsentVersion: 2 })).toBe(false);
    expect(paperNameable({ ...base, integrityFlag: "unsigned" })).toBe(false);
    expect(paperNameable({ ...base, displayName: "Hitler" })).toBe(false);
    expect(paperNameable({ ...base, needsRename: true })).toBe(false);
    expect(paperNameable(null)).toBe(false);
  });
});

describe("a full week", () => {
  test("publishes the expected stories and tables, covering the thin week before it", async () => {
    const { t, week2 } = await buildWorld();
    expect(week2.weekly).toMatchObject({ status: "published", issue: 1 });
    const paper = await edition(t);
    expect(paper).not.toBeNull();
    expect(paper!.issue).toBe(1);
    expect(paper!.state).toBe("published");
    // The thin week folded in: the edition starts on Nov 2.
    expect(paper!.periodStart).toBe(Date.UTC(2026, 10, 2, 5));
    expect(paper!.periodEnd).toBe(Date.UTC(2026, 10, 16, 5));

    const kinds = paper!.stories.map((story) => `${story.kind}:${story.drivers.map((d) => d.driverId).join(",")}`);
    expect(kinds).toEqual(expect.arrayContaining([
      "first_into_city:alice", "promotion:alice", "mile_club:alice", "delivery_club:alice",
      "best_on_time:alice", "most_deliveries:alice", "most_miles:bob", "longest_haul:bob",
      "heaviest_load:bob", "new_hires:gina-new", "blotter_citations:", "busiest_lane:", "week_totals:",
    ]));
    // The front page: first into a city, promotion, most miles, by rank.
    expect(paper!.stories.slice(0, 3).map((story) => story.kind)).toEqual(["first_into_city", "promotion", "most_miles"]);
    expect(paper!.stories.slice(0, 3).every((story) => story.section === "front_page")).toBe(true);

    const first = paper!.stories.find((story) => story.kind === "first_into_city")!;
    expect(first.headline).toBe("{@alice} is first into Omaha, Nebraska");
    expect(first.drivers).toEqual([{ driverId: "alice", displayName: "Alice Hauler" }]);
    const heaviest = paper!.stories.find((story) => story.kind === "heaviest_load")!;
    expect(heaviest.body).toContain("80,000 pounds");
    const lane = paper!.stories.find((story) => story.kind === "busiest_lane")!;
    expect(lane.headline).toBe("Busiest lane: Chicago, Illinois to Dallas, Texas");
    const blotter = paper!.stories.find((story) => story.kind === "blotter_citations")!;
    expect(blotter.drivers).toEqual([]);

    expect(paper!.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ record: "most_miles", driverId: "bob", value: 4_000 }),
      expect.objectContaining({ record: "heaviest_load", driverId: "bob", value: 80_000 }),
      expect.objectContaining({ record: "best_on_time", driverId: "alice", value: 7 }),
    ]));
    expect(paper!.standings).toEqual([
      expect.objectContaining({ carrier: "Northstar Freight Lines", drivers: 2, loads: 11, miles: 4_900 }),
    ]);
    expect(paper!.backPage.map((piece) => piece.kind)).toEqual(["column", "want_ad", "cb_letter"]);

    const editions = await t.query(api.freightFatePaper.listEditions, {});
    expect(editions).toEqual([expect.objectContaining({ issue: 1, weekKey: "2026-11-09" })]);
  });

  test("no hidden driver, catalog miss or free text appears anywhere", async () => {
    const { t } = await buildWorld();
    const text = JSON.stringify(await edition(t));
    for (const hidden of HIDDEN) expect(text).not.toContain(hidden);
    for (const name of ["Carol", "Dan Guest", "Erin", "Hitler", "Driver sked"]) expect(text).not.toContain(name);
    expect(text).not.toContain("Atlantis");
    expect(text).not.toContain("NOTABLE-NOTE");
    expect(text).not.toContain("steel coils");
    expect(text).not.toContain("9,000");
    const stored = JSON.stringify(await dump(t));
    expect(stored).not.toContain("Atlantis");
    expect(stored).not.toContain("NOTABLE-NOTE");
    // The longest haul lost its unmatched origin, not the story.
    const paper = await edition(t);
    const longest = paper!.stories.find((story) => story.kind === "longest_haul")!;
    expect(longest.body).toBe("{@bob} ran the week's longest single load, 2,400 miles.");
  });

  test("a driver who turns sharing off leaves the edition, and comes back", async () => {
    const { t } = await buildWorld();
    await patchDriver(t, "alice", { visibility: "private", sharingConsentVersion: undefined });
    const without = await edition(t);
    expect(JSON.stringify(without)).not.toContain("alice");
    expect(without!.records.some((row) => row.driverId === "alice")).toBe(false);
    await patchDriver(t, "alice", { visibility: "public", sharingConsentVersion: SHARING_CONSENT_VERSION });
    const back = await edition(t);
    expect(back!.stories.some((story) => story.drivers.some((d) => d.driverId === "alice"))).toBe(true);
  });

  test("a renamed driver is printed under the name they have now", async () => {
    const { t } = await buildWorld();
    await patchDriver(t, "bob", { displayName: "Robert Freight" });
    const paper = await edition(t);
    const story = paper!.stories.find((s) => s.kind === "most_miles")!;
    expect(story.drivers).toEqual([{ driverId: "bob", displayName: "Robert Freight" }]);
  });

  test("account deletion removes the ledger and tallies rows and the first's driver", async () => {
    const { t } = await buildWorld();
    await deliver(t, "alice", WEEK3, { origin: "Chicago, Illinois", destination: "Dallas, Texas", miles: 900, pounds: 1 });
    await run(t, WEEK3 + DAY);
    const before = await dump(t);
    expect(before.freightFatePaperLedger.some((row) => (row as { driverId: string }).driverId === "alice")).toBe(true);
    expect(before.freightFatePaperDriverTallies.some((row) => (row as { driverId: string }).driverId === "alice")).toBe(true);
    await t.run((ctx) => purgeDriver(ctx, "alice"));
    const after = await dump(t);
    for (const table of ["freightFatePaperLedger", "freightFatePaperDriverTallies"] as const) {
      expect(after[table].some((row) => (row as { driverId: string }).driverId === "alice")).toBe(false);
    }
    const omaha = after.freightFatePaperFirsts.find((row) => (row as { cityKey: string }).cityKey === "omaha_ne_us") as
      Doc<"freightFatePaperFirsts">;
    expect(omaha.driverId).toBeUndefined();
    expect(JSON.stringify(await edition(t))).not.toContain("alice");
  });

  test("each job run twice changes nothing the second time", async () => {
    const { t } = await buildWorld();
    const once = await dump(t);
    await run(t, MON2);
    expect(await dump(t)).toEqual(once);
    await deliver(t, "bob", WEEK3, { origin: "Gary", destination: "Laredo, Texas", miles: 1_500, pounds: 20_000 });
    await run(t, WEEK3 + DAY);
    const daily = await dump(t);
    await run(t, WEEK3 + DAY);
    expect(await dump(t)).toEqual(daily);
  });

  test("the brief counts the open week on the newest edition", async () => {
    const { t } = await buildWorld();
    await deliver(t, "bob", WEEK3, { origin: "Gary", destination: "Laredo, Texas", miles: 1_500, pounds: 20_000 });
    await run(t, WEEK3 + DAY);
    const paper = await edition(t);
    expect(paper!.sinceMonday).toMatchObject({ weekKey: "2026-11-16", loads: 1, miles: 1_500, tons: 10, drivers: 1 });
  });
});

describe("careers that changed under the paper", () => {
  test("a career switch and a restore from an older backup make no records", async () => {
    const { t } = await buildWorld();
    // Alice switches careers with bigger numbers; Bob restores an older backup.
    await setSnapshot(t, "alice", SNAP3, {
      saveName: "Second career", sourceSaveName: "Second career", deliveries: 500, milesDriven: 900_000, onTimeDeliveries: 500,
    });
    await setSnapshot(t, "bob", SNAP3, { deliveries: 30, milesDriven: 45_000, onTimeDeliveries: 25 });
    await setSnapshot(t, "hank", SNAP3, { deliveries: 26, milesDriven: 10_000, onTimeDeliveries: 26 });
    await deliver(t, "alice", WEEK3, { origin: "Chicago, Illinois", destination: "Denver, Colorado", miles: 3_000, pounds: 90_000 });
    await deliver(t, "hank", WEEK3, { origin: "Chicago, Illinois", destination: "Dallas, Texas", miles: 900, pounds: 30_000 });
    const result = await run(t, MON3);
    expect(result.weekly).toMatchObject({ status: "published", issue: 2 });
    const paper = await edition(t);
    expect(paper!.issue).toBe(2);
    expect(paper!.records.every((row) => row.driverId === "hank")).toBe(true);
    expect(paper!.records.map((row) => row.record)).toEqual(expect.arrayContaining(["most_miles", "best_on_time", "longest_haul"]));
    expect(paper!.stories.some((story) => story.kind === "mile_club")).toBe(false);
    // The ledger follows the new career and the restored numbers.
    const ledger = (await dump(t)).freightFatePaperLedger as Array<Doc<"freightFatePaperLedger">>;
    expect(ledger.find((row) => row.driverId === "alice")).toMatchObject({ saveName: "Second career", milesDriven: 900_000 });
    expect(ledger.find((row) => row.driverId === "bob")).toMatchObject({ milesDriven: 45_000 });
  });
});

describe("the switch", () => {
  test("off reads nothing and answers null", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "off");
    const t = setup();
    await addDriver(t, "alice", "Alice Hauler");
    await deliver(t, "alice", WEEK2, { origin: "Gary", destination: "Laredo, Texas", miles: 1_500, pounds: 1 });
    expect(await run(t, MON2, true)).toEqual({ mode: "off", events: 0 });
    expect((await dump(t)).freightFatePaperState).toEqual([]);
    expect(await edition(t)).toBeNull();
    expect(await t.query(api.freightFatePaper.listEditions, {})).toBeNull();
  });

  test("unset is off", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "");
    const t = setup();
    expect(await run(t, MON2, true)).toEqual({ mode: "off", events: 0 });
  });

  test("preview builds editions only the admin can read, until one is published", async () => {
    const { t } = await buildWorld("preview");
    expect(await edition(t)).toBeNull();
    expect(await edition(t, 1)).toBeNull();
    expect(await t.query(api.freightFatePaper.listEditions, {})).toEqual([]);
    const preview = await edition(t, undefined, ADMIN);
    expect(preview).toMatchObject({ issue: 1, state: "preview" });
    expect(await edition(t, undefined, { ...ADMIN, email: "someone@example.com" })).toBeNull();
    // Turning the switch on does not publish a preview by itself.
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    expect(await edition(t)).toBeNull();
    await t.mutation(internal.freightFatePaper.publishEdition, { issue: 1 });
    expect(await edition(t)).toMatchObject({ issue: 1, state: "published" });
  });

  test("a pulled edition and a pulled story leave the paper", async () => {
    const { t } = await buildWorld();
    const paper = await edition(t);
    const story = paper!.stories.find((s) => s.kind === "most_miles")!;
    await t.mutation(internal.freightFatePaper.pullStory, { issue: 1, storyId: story.id });
    expect((await edition(t))!.stories.some((s) => s.id === story.id)).toBe(false);
    await t.mutation(internal.freightFatePaper.pullEdition, { issue: 1 });
    expect(await edition(t)).toBeNull();
    expect(await t.query(api.freightFatePaper.listEditions, {})).toEqual([]);
    await t.mutation(internal.freightFatePaper.publishEdition, { issue: 1 });
    expect(await edition(t)).toMatchObject({ issue: 1 });
    await expect(t.mutation(internal.freightFatePaper.publishEdition, { issue: 1 })).rejects.toThrow();
  });
});

describe("a failed build", () => {
  test("goes to the owner's digest once", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    const t = setup();
    await t.mutation(internal.freightFatePaper.recordFailure, { now: MON2, message: "boom" });
    await t.mutation(internal.freightFatePaper.recordFailure, { now: MON2, message: "boom again" });
    expect(await t.query(internal.freightFatePaper.unreportedFailures, {}))
      .toEqual(["The paper did not publish for the week of 2026-11-09: boom"]);
    await t.mutation(internal.freightFatePaper.markFailuresReported, {});
    expect(await t.query(internal.freightFatePaper.unreportedFailures, {})).toEqual([]);
  });
});

describe("version 2 deliveries", () => {
  test("keys are used and the text ignored", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    const t = setup();
    await addDriver(t, "alice", "Alice Hauler");
    await run(t, FIRST_RUN);
    await deliver(t, "alice", WEEK1_EVENT, {
      version: 2, origin: "Nowhere", destination: "Elsewhere", miles: 500, pounds: 10_000,
      keys: { cargoKey: "bulk", originKey: "chicago_il_us", destinationKey: "gary_in_us" },
    });
    await run(t, WEEK1_EVENT + DAY);
    const tallies = (await dump(t)).freightFatePaperWeekTallies as Array<Doc<"freightFatePaperWeekTallies">>;
    expect(tallies[0].lanes).toEqual([{ originKey: "chicago_il_us", destinationKey: "gary_in_us", count: 1 }]);
    expect(tallies[0].cargo).toEqual([{ key: "bulk", count: 1, pounds: 10_000 }]);
  });

  test("the delivery route takes version 2 and refuses an unknown key", async () => {
    const t = setup();
    const payload = {
      version: 2 as const, cargo: "bulk", weightPounds: 1, origin: "a", destination: "b",
      distanceMiles: 1, onTime: true, cargoKey: "bulk", originKey: "chicago_il_us", destinationKey: "gary_in_us",
      conditions: { weather: ["snow"], chainLaw: true, workZones: 2, scales: 1, inspections: 0 },
    };
    const call = (p: typeof payload) => t.mutation(api.freightFate.publishDeliveryCompleted, {
      driverId: "nobody", driverTokenHash: "x", eventId: "e", occurredAt: 0, now: 0, payload: p,
    });
    expect(await call(payload)).toMatchObject({ ok: false, reason: "driver_not_found" });
    expect(await call({ ...payload, cargoKey: "moon_rocks" })).toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(await call({ ...payload, originKey: "atlantis" })).toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(await call({ ...payload, conditions: { ...payload.conditions, weather: ["Snow!"] } }))
      .toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(await call({ ...payload, conditions: { ...payload.conditions, scales: 501 } }))
      .toMatchObject({ ok: false, reason: "invalid_payload" });
  });
});

describe("firsts", () => {
  test("the first run seeds visited cities with no stories", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    const t = setup();
    await addDriver(t, "alice", "Alice Hauler");
    await setSnapshot(t, "alice", LONG_AGO, {
      visitedPlaces: [{ state: "Illinois", cities: ["Chicago", "Atlantis"] }, { state: "Texas", cities: ["Dallas"] }],
    });
    await run(t, FIRST_RUN);
    const firsts = (await dump(t)).freightFatePaperFirsts as Array<Doc<"freightFatePaperFirsts">>;
    expect(firsts.map((row) => row.cityKey).sort()).toEqual(["chicago_il_us", "dallas_tx_us"]);
    expect(firsts.every((row) => row.seeded && row.reported && row.driverId === undefined)).toBe(true);
  });
});
