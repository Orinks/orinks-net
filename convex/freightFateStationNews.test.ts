/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const NOW = 1_800_000_000_000;

const web = {
  driverId: "night-owl-1234",
  kind: "web" as const,
  name: "Night Owl Radio",
  streamUrl: "https://s.example/live",
  streamKey: "s.example/live",
  streamFormat: "mp3",
  genre: "jazz",
  note: "my favourite",
  catalogChecked: true,
  status: "pending" as const,
  createdAt: NOW - 1000,
};
const terrestrial = {
  ...web,
  kind: "terrestrial" as const,
  name: "The Cat",
  streamUrl: "https://icecast.example/thecat",
  streamKey: "icecast.example/thecat",
  genre: undefined,
  callSign: "KWSC-FM",
  callSignBase: "KWSC",
  frequency: "91.9 FM",
  city: "Wayne",
  state: "NE",
};

async function seed(rows: Array<Record<string, unknown>>) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) =>
    Promise.all(rows.map((row) => ctx.db.insert("freightFateStationSuggestions", row as typeof web))),
  );
  return { t, ids };
}

describe("station announcements", () => {
  test("an accepted batch is recorded as one announcement with each station's public facts", async () => {
    const { t, ids } = await seed([web, terrestrial]);
    await t.mutation(internal.freightFateStations.decideStations, {
      ids, decision: "accepted", issuedAt: NOW, now: NOW + 5,
    });
    const news = await t.query(api.freightFateStationNews.listStationNews, {});
    expect(news).toHaveLength(1);
    expect(news[0].createdAt).toBe(NOW + 5);
    expect(news[0].stations).toEqual([
      { id: ids[0], name: "Night Owl Radio", kind: "web", genre: "jazz" },
      {
        id: ids[1], name: "The Cat", kind: "terrestrial",
        callSign: "KWSC-FM", frequency: "91.9 FM", city: "Wayne", state: "Nebraska",
      },
    ]);
  });

  test("a declined batch, or one where nothing was still pending, records nothing", async () => {
    const { t, ids } = await seed([web]);
    await t.mutation(internal.freightFateStations.decideStations, {
      ids, decision: "declined", issuedAt: NOW, now: NOW + 5,
    });
    await t.mutation(internal.freightFateStations.decideStations, {
      ids, decision: "accepted", issuedAt: NOW, now: NOW + 6,
    });
    expect(await t.query(api.freightFateStationNews.listStationNews, {})).toEqual([]);
  });

  test("a station accepted from an older single-station link gets its own announcement", async () => {
    const { t, ids } = await seed([web]);
    await t.mutation(internal.freightFateStations.decideStationSuggestion, {
      id: ids[0], decision: "accepted", createdAt: web.createdAt, now: NOW + 7,
    });
    const news = await t.query(api.freightFateStationNews.listStationNews, {});
    expect(news.map((row) => row.stations.map((station) => station.name))).toEqual([["Night Owl Radio"]]);
  });

  test("stations accepted before announcements existed are announced once, batch by batch", async () => {
    const { t } = await seed([
      { ...web, status: "accepted", decidedAt: NOW + 1 },
      { ...terrestrial, status: "accepted", decidedAt: NOW + 1 },
      { ...web, name: "Later", streamKey: "later", status: "accepted", decidedAt: NOW + 2 },
      { ...web, name: "No time", streamKey: "none", status: "accepted" },
      { ...web, name: "Waiting", streamKey: "wait" },
    ]);
    expect(await t.mutation(internal.freightFateStationNews.announceEarlierBatches, {})).toEqual({ announcements: 2 });
    expect(await t.mutation(internal.freightFateStationNews.announceEarlierBatches, {})).toEqual({ announcements: 0 });
    const news = await t.query(api.freightFateStationNews.listStationNews, {});
    expect(news.map((row) => [row.createdAt, row.stations.map((station) => station.name)])).toEqual([
      [NOW + 1, ["Night Owl Radio", "The Cat"]],
      [NOW + 2, ["Later"]],
    ]);
  });
});
