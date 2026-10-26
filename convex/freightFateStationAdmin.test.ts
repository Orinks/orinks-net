/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const NOW = 1_800_000_000_000;

const fake = {
  driverId: "prankster-1234",
  kind: "terrestrial" as const,
  name: "Sleep Radio",
  streamUrl: "https://sleep.example/live",
  streamKey: "sleep.example/live",
  streamFormat: "mp3",
  genre: "ambient",
  callSign: "WXYZ",
  callSignBase: "WXYZ",
  frequency: "101.1 FM",
  frequencyMhz: 101.1,
  city: "Detroit",
  state: "MI",
  lat: 42.3,
  lon: -83.0,
  rangeMiles: 60,
  placement: "fcc" as const,
  placementCheckedAt: NOW,
  catalogChecked: true,
  status: "pending" as const,
  createdAt: NOW - 1000,
};
const other = {
  ...fake,
  name: "Night Owl Radio",
  streamUrl: "https://owl.example/live",
  streamKey: "owl.example/live",
  callSign: "KOWL",
  callSignBase: "KOWL",
};

async function acceptBoth() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) =>
    Promise.all([fake, other].map((row) => ctx.db.insert("freightFateStationSuggestions", row))),
  );
  await t.mutation(internal.freightFateStations.decideStations, {
    ids, decision: "accepted", issuedAt: NOW, now: NOW + 5,
  });
  return { t, ids };
}

describe("station corrections", () => {
  test("findStations matches name or call sign, ignoring case", async () => {
    const { t, ids } = await acceptBoth();
    const byName = await t.query(internal.freightFateStationAdmin.findStations, { text: "sleep" });
    expect(byName.map((row) => row.id)).toEqual([ids[0]]);
    const byCall = await t.query(internal.freightFateStationAdmin.findStations, { text: "kowl" });
    expect(byCall.map((row) => row.id)).toEqual([ids[1]]);
  });

  test("makeWebStation drops the call sign and transmitter so the game plays it everywhere", async () => {
    const { t, ids } = await acceptBoth();
    const result = await t.mutation(internal.freightFateStationAdmin.makeWebStation, { id: ids[0] });
    expect(result).toEqual({ changed: true, name: "Sleep Radio", announcements: 1 });

    const list = await t.query(api.freightFateStations.listCommunityStations, {});
    const sleep = list.stations.find((station) => station.name === "Sleep Radio")!;
    expect(sleep).toMatchObject({
      call_sign: "",
      station_type: "web",
      always_available: true,
      market: "",
      region: "",
    });
    expect(sleep.lat).toBeUndefined();
    expect(sleep.frequency_mhz).toBeUndefined();

    const row = await t.run((ctx) => ctx.db.get(ids[0]));
    expect(row).toMatchObject({ kind: "web", status: "accepted", streamUrl: fake.streamUrl, genre: "ambient" });
    expect(row?.callSignBase).toBeUndefined();
    expect(row?.placement).toBeUndefined();
  });

  test("makeWebStation corrects the announcement and leaves the other stations in it alone", async () => {
    const { t, ids } = await acceptBoth();
    await t.mutation(internal.freightFateStationAdmin.makeWebStation, { id: ids[0] });
    const news = await t.query(api.freightFateStationNews.listStationNews, {});
    expect(news[0].stations).toEqual([
      { id: ids[0], name: "Sleep Radio", kind: "web", genre: "ambient" },
      {
        id: ids[1], name: "Night Owl Radio", kind: "terrestrial", genre: "ambient",
        callSign: "KOWL", frequency: "101.1 FM", city: "Detroit", state: "Michigan",
      },
    ]);
  });

  test("makeWebStation on a web station changes nothing", async () => {
    const { t, ids } = await acceptBoth();
    await t.mutation(internal.freightFateStationAdmin.makeWebStation, { id: ids[0] });
    const again = await t.mutation(internal.freightFateStationAdmin.makeWebStation, { id: ids[0] });
    expect(again).toEqual({ changed: false, name: "Sleep Radio", announcements: 0 });
  });

  test("setStreamUrl moves a pending suggestion to the new address", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("freightFateStationSuggestions", fake));
    const result = await t.mutation(internal.freightFateStationAdmin.setStreamUrl, {
      id, streamUrl: " http://Sleep.example:8000/tv.mp3 ",
    });
    expect(result).toMatchObject({ status: "pending", from: fake.streamUrl, to: "http://Sleep.example:8000/tv.mp3" });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({
      streamUrl: "http://Sleep.example:8000/tv.mp3",
      streamKey: "sleep.example:8000/tv.mp3",
      streamUnheard: true,
      status: "pending",
    });
  });

  test("setStreamUrl refuses a stream another suggestion has, and a non-web address", async () => {
    const t = convexTest(schema, modules);
    const [id] = await t.run(async (ctx) =>
      Promise.all([fake, other].map((row) => ctx.db.insert("freightFateStationSuggestions", row))),
    );
    await expect(
      t.mutation(internal.freightFateStationAdmin.setStreamUrl, { id, streamUrl: "https://owl.example/live/" }),
    ).rejects.toThrow(/Night Owl Radio/);
    await expect(
      t.mutation(internal.freightFateStationAdmin.setStreamUrl, { id, streamUrl: "ftp://sleep.example/x" }),
    ).rejects.toThrow(/http/);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.streamUrl).toBe(fake.streamUrl);
  });
});
