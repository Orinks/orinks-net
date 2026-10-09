/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  STATION_DEAD_AFTER,
  STATION_SUGGEST_WRITE_LIMIT,
  signStationClaim,
  verifyStationClaim,
} from "./freightFateStations";
import { DAILY_SUGGESTION_LIMIT } from "./freightFateStationRules";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

const NOW = 1_800_000_000_000;
const DRIVER = "night-owl-1234";
const TOKEN_HASH = "a".repeat(64);
const SUBJECT = "user_2stationTest";

async function seedDriver(t: ReturnType<typeof setup>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("freightFateDrivers", {
      driverId: DRIVER,
      displayName: "Night Owl",
      visibility: "public",
      authSubject: SUBJECT,
      driverTokenHash: TOKEN_HASH,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

const webStation = {
  kind: "web" as const,
  name: "Night Owl Radio",
  streamUrl: "https://s.example/live",
  streamKey: "s.example/live",
  streamFormat: "mp3",
  catalogChecked: true,
};

const terrestrialStation = {
  kind: "terrestrial" as const,
  name: "The Cat",
  streamUrl: "https://icecast.example/thecat",
  streamKey: "icecast.example/thecat",
  streamFormat: "aac",
  callSign: "KWSC-FM",
  callSignBase: "KWSC",
  frequency: "91.9 FM",
  frequencyMhz: 91.9,
  city: "Wayne",
  state: "NE",
  catalogChecked: true,
};

function admit(t: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return t.mutation(internal.freightFateStations.admitSuggestion, {
    driverId: DRIVER,
    driverTokenHash: TOKEN_HASH,
    streamKey: "s.example/live",
    now: NOW,
    ...overrides,
  });
}

async function suggest(t: ReturnType<typeof setup>, station: Record<string, unknown>, now = NOW) {
  return t.mutation(internal.freightFateStations.recordSuggestion, {
    ...(station as typeof webStation),
    driverId: DRIVER,
    now,
  });
}

async function onlyRow(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => (await ctx.db.query("freightFateStationSuggestions").collect())[0]);
}

describe("admitSuggestion", () => {
  test("lets a signed-in driver suggest a new stream", async () => {
    const t = setup();
    await seedDriver(t);
    expect(await admit(t)).toEqual({ ok: true, driverId: DRIVER });
    expect(
      await t.mutation(internal.freightFateStations.admitSuggestion, {
        authSubject: SUBJECT,
        streamKey: "other.example/x",
        now: NOW + 60_000,
      }),
    ).toEqual({ ok: true, driverId: DRIVER });
  });

  test("refuses a wrong token and an unknown driver", async () => {
    const t = setup();
    await seedDriver(t);
    expect(await admit(t, { driverTokenHash: "b".repeat(64) })).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(await admit(t, { driverId: "nobody-00000000" })).toMatchObject({ ok: false, reason: "driver_not_found" });
  });

  test("counts attempts per minute and suggestions per day", async () => {
    const t = setup();
    await seedDriver(t);
    for (let i = 0; i < STATION_SUGGEST_WRITE_LIMIT; i += 1) {
      expect(await admit(t)).toMatchObject({ ok: true });
    }
    expect(await admit(t)).toMatchObject({ ok: false, reason: "rate_limited" });

    for (let i = 0; i < DAILY_SUGGESTION_LIMIT; i += 1) {
      await suggest(t, { ...webStation, streamUrl: `https://s${i}.example/`, streamKey: `s${i}.example` }, NOW + i);
    }
    expect(await admit(t, { now: NOW + 120_000 })).toMatchObject({ ok: false, reason: "daily_limit" });
    expect(await admit(t, { now: NOW + 25 * 60 * 60 * 1000 })).toMatchObject({ ok: true });
  });

  test("refuses a stream or call sign already suggested, and says when it was turned down", async () => {
    const t = setup();
    await seedDriver(t);
    await suggest(t, terrestrialStation);
    expect(await admit(t, { streamKey: "icecast.example/thecat" })).toMatchObject({ reason: "duplicate_suggestion" });
    expect(await admit(t, { streamKey: "new.example/x", callSignBase: "KWSC", now: NOW + 60_000 })).toMatchObject({
      reason: "duplicate_suggestion",
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("freightFateStationSuggestions").collect())[0];
      await ctx.db.patch(row._id, { status: "declined" });
    });
    expect(await admit(t, { streamKey: "icecast.example/thecat", now: NOW + 120_000 })).toMatchObject({
      reason: "already_declined",
    });
  });
});

describe("the community station list", () => {
  test("lists accepted stations only, in the game's row shape", async () => {
    const t = setup();
    await seedDriver(t);
    await suggest(t, webStation);
    expect((await t.query(api.freightFateStations.listCommunityStations, {})).stations).toEqual([]);
    const row = await onlyRow(t);
    await t.mutation(internal.freightFateStations.decideStationSuggestion, {
      id: row._id, decision: "accepted", createdAt: row.createdAt, now: NOW + 1,
    });
    const { schema: version, stations } = await t.query(api.freightFateStations.listCommunityStations, {});
    expect(version).toBe(1);
    expect(stations).toEqual([
      expect.objectContaining({
        id: `community-${row._id}`,
        name: "Night Owl Radio",
        source_type: "web",
        stream_url: "https://s.example/live",
        stream_format: "mp3",
        real_stream: true,
        always_available: true,
        safe_for_streaming: false,
      }),
    ]);
  });

  test("a terrestrial station plays everywhere until its transmitter is filled in", async () => {
    const t = setup();
    await seedDriver(t);
    await suggest(t, terrestrialStation);
    const row = await onlyRow(t);
    await t.run(async (ctx) => ctx.db.patch(row._id, { status: "accepted" }));
    let [station] = (await t.query(api.freightFateStations.listCommunityStations, {})).stations;
    expect(station).toMatchObject({ source_type: "web", always_available: true, call_sign: "KWSC-FM", region: "NE" });
    expect(station).not.toHaveProperty("lat");

    await t.run(async (ctx) => ctx.db.patch(row._id, { lat: 42.24, lon: -97.01, rangeMiles: 30 }));
    [station] = (await t.query(api.freightFateStations.listCommunityStations, {})).stations;
    expect(station).toMatchObject({
      source_type: "imported",
      always_available: false,
      lat: 42.24,
      lon: -97.01,
      range_miles: 30,
      frequency_mhz: 91.9,
      market: "Wayne",
    });
  });

  test("a stream that fails night after night leaves the list, and comes back when it answers", async () => {
    const t = setup();
    await seedDriver(t);
    await suggest(t, webStation);
    const row = await onlyRow(t);
    await t.run(async (ctx) => ctx.db.patch(row._id, { status: "accepted" }));
    expect(await t.query(internal.freightFateStations.stationsToRecheck, { limit: 10 })).toEqual([
      { id: row._id, streamUrl: webStation.streamUrl },
    ]);
    for (let night = 0; night < STATION_DEAD_AFTER; night += 1) {
      await t.mutation(internal.freightFateStations.recordStationCheck, { id: row._id, ok: false, now: NOW + night });
    }
    expect((await t.query(api.freightFateStations.listCommunityStations, {})).stations).toEqual([]);
    await t.mutation(internal.freightFateStations.recordStationCheck, { id: row._id, ok: true, now: NOW + 10 });
    expect((await t.query(api.freightFateStations.listCommunityStations, {})).stations).toHaveLength(1);
  });
});

describe("the station digest and its links", () => {
  const savedSecret = process.env.FREIGHT_FATE_REVIEW_SECRET;
  afterEach(() => {
    process.env.FREIGHT_FATE_REVIEW_SECRET = savedSecret;
  });

  test("lists pending suggestions only on a day something new arrived", async () => {
    const t = setup();
    await seedDriver(t);
    expect(await t.query(internal.freightFateStations.listStationDigest, {})).toEqual([]);
    await suggest(t, terrestrialStation);
    const rows = await t.query(internal.freightFateStations.listStationDigest, {});
    expect(rows).toEqual([
      expect.objectContaining({ name: "The Cat", displayName: "Night Owl", callSign: "KWSC-FM", isNew: true }),
    ]);
    await t.mutation(internal.freightFateStations.markStationDigestSent, { ids: [rows[0].id], now: NOW + 1 });
    expect(await t.query(internal.freightFateStations.listStationDigest, {})).toEqual([]);
  });

  test("a signed link decides once, and only for its own suggestion", async () => {
    process.env.FREIGHT_FATE_REVIEW_SECRET = "s".repeat(40);
    const t = setup();
    await seedDriver(t);
    await suggest(t, webStation);
    const row = await onlyRow(t);
    const token = await signStationClaim({
      id: row._id, decision: "accepted", createdAt: row.createdAt, expiresAt: NOW + 1000,
    });
    expect(token).toBeTruthy();
    expect(await verifyStationClaim(token!, NOW)).toMatchObject({ id: row._id, decision: "accepted" });
    expect(await verifyStationClaim(token!, NOW + 2000)).toBeNull();
    expect(await verifyStationClaim(token!.replace(".accepted.", ".declined."), NOW)).toBeNull();

    const page = await t.fetch(`/freight-fate/station-review?t=${encodeURIComponent(token!)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Accept Night Owl Radio?");
  });

  test("decideStationSuggestion refuses a second decision", async () => {
    const t = setup();
    await seedDriver(t);
    await suggest(t, webStation);
    const row = await onlyRow(t);
    const decide = (decision: "accepted" | "declined") =>
      t.mutation(internal.freightFateStations.decideStationSuggestion, {
        id: row._id, decision, createdAt: row.createdAt, now: NOW + 1,
      });
    expect(await decide("declined")).toMatchObject({ ok: true, name: "Night Owl Radio" });
    expect(await decide("accepted")).toEqual({ ok: false });
  });
});
