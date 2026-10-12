/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  ANONYMOUS_DAILY_LIMIT,
  ANONYMOUS_SUGGESTER,
  REFUSALS,
  SUGGESTION_RECEIVED_UNHEARD,
} from "./freightFateStationRules";

// The whole suggestion action, with the stream's host never answering: no DNS
// record, and the shipped catalog out of reach too.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  }),
}));

const modules = import.meta.glob("./**/*.ts");
const SUBJECT = "user_2suggestTest";

let humanCheckPasses = true;
let sentSecrets: string[] = [];

beforeEach(() => {
  humanCheckPasses = true;
  sentSecrets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes("challenges.cloudflare.com")) return new Response("", { status: 503 });
      const secret = new URLSearchParams(String(init?.body)).get("secret") ?? "";
      sentSecrets.push(secret);
      if (secret !== "secret") return Response.json({ success: false, "error-codes": ["invalid-input-secret"] }, { status: 400 });
      return Response.json({ success: humanCheckPasses });
    }),
  );
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("suggesting a station whose stream does not answer", () => {
  test("goes to review marked unheard instead of being turned away", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "treehouse-1",
        displayName: "Treehouse",
        visibility: "public",
        authSubject: SUBJECT,
        driverTokenHash: "b".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const result = await t.withIdentity({ subject: SUBJECT }).action(api.freightFateStationVetting.suggestStationSignedIn, {
      kind: "web",
      name: "Treehouse Radio",
      streamUrl: "http://s6.autopo.st:8515/live",
    });
    expect(result).toEqual({ ok: true, message: SUGGESTION_RECEIVED_UNHEARD });
    const rows = await t.run(async (ctx) => ctx.db.query("freightFateStationSuggestions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", streamUnheard: true, streamFormat: "unknown", catalogChecked: false });
  });
});

describe("suggesting stations picked from a playlist", () => {
  test("sends each pick as its own suggestion, up to the day's allowance", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("freightFateDrivers", {
        driverId: "treehouse-1",
        displayName: "Treehouse",
        visibility: "public",
        authSubject: SUBJECT,
        driverTokenHash: "b".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const stations = [
      ...[1, 2, 3, 4].map((n) => ({ name: `Pick ${n}`, streamUrl: `http://s${n}.example/live` })),
      // No title in the playlist, and its stream can't be heard to name it.
      { name: "", streamUrl: "http://s5.example/live" },
      ...[6, 7].map((n) => ({ name: `Pick ${n}`, streamUrl: `http://s${n}.example/live` })),
    ];
    const result = await t
      .withIdentity({ subject: SUBJECT })
      .action(api.freightFateStationVetting.suggestListedStationsSignedIn, { stations, genre: "Trance" });
    expect(result.ok && result.results.map((r) => r.ok || r.reason)).toEqual([
      true, true, true, true, "no_station_name", "daily_limit", "daily_limit",
    ]);
    const rows = await t.run(async (ctx) => ctx.db.query("freightFateStationSuggestions").collect());
    expect(rows.map((row) => row.name).sort()).toEqual(["Pick 1", "Pick 2", "Pick 3", "Pick 4"]);
    expect(rows.every((row) => row.kind === "web" && row.genre === "Trance")).toBe(true);
  });

  test("a signed-out send needs the human check", async () => {
    const t = convexTest(schema, modules);
    humanCheckPasses = false;
    expect(
      await t.action(api.freightFateStationVetting.suggestListedStationsAnonymous, {
        turnstileToken: "token",
        stations: [{ name: "Pick", streamUrl: "http://s1.example/live" }],
      }),
    ).toMatchObject({ ok: false, reason: "human_check" });
  });
});

describe("suggesting without signing in", () => {
  const anonymous = (t: ReturnType<typeof convexTest>, name: string, streamUrl: string) =>
    t.action(api.freightFateStationVetting.suggestStationAnonymous, {
      turnstileToken: "token",
      kind: "web",
      name,
      streamUrl,
    });

  test("passes the human check, then goes to review like any other", async () => {
    const t = convexTest(schema, modules);
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toEqual({
      ok: true,
      message: SUGGESTION_RECEIVED_UNHEARD,
    });
    const rows = await t.run(async (ctx) => ctx.db.query("freightFateStationSuggestions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driverId: ANONYMOUS_SUGGESTER, status: "pending" });
  });

  test("is refused without the human check, or when the site has none", async () => {
    const t = convexTest(schema, modules);
    humanCheckPasses = false;
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toMatchObject({
      ok: false,
      reason: "human_check",
    });
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toMatchObject({
      ok: false,
      reason: "not_configured",
    });
  });

  test("passes the human check with a secret copied in with its quotes and a written-out newline", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("TURNSTILE_SECRET_KEY", '"secret\\n"');
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toMatchObject({ ok: true });
    expect(sentSecrets).toEqual(["secret"]);
  });

  test("treats a Sensitive variable's placeholder as no secret", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "[SENSITIVE]");
    expect(await t.query(api.freightFateStations.anonymousSuggestionsOpen, {})).toBe(false);
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toMatchObject({
      ok: false,
      reason: "not_configured",
    });
    expect(sentSecrets).toEqual([]);
  });

  test("blames the site, not the visitor, when Cloudflare refuses the secret", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "not-the-secret");
    expect(await anonymous(t, "Treehouse Radio", "http://s6.autopo.st:8515/live")).toMatchObject({
      ok: false,
      reason: "not_configured",
    });
  });

  test("everyone not signed in shares one daily allowance", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < ANONYMOUS_DAILY_LIMIT; i += 1) {
        await ctx.db.insert("freightFateStationSuggestions", {
          driverId: ANONYMOUS_SUGGESTER,
          kind: "web",
          name: `Station ${i}`,
          streamUrl: `https://s${i}.example/live`,
          streamKey: `s${i}.example/live`,
          streamFormat: "mp3",
          catalogChecked: true,
          status: "pending",
          createdAt: Date.now() - 1000,
        });
      }
    });
    expect(await anonymous(t, "One More", "https://one-more.example/live")).toEqual({
      ok: false,
      reason: "anonymous_limit",
      message: REFUSALS.anonymous_limit,
    });
  });
});

test("the signed-out form is offered only once the human check has its secret", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.freightFateStations.anonymousSuggestionsOpen, {})).toBe(true);
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  expect(await t.query(api.freightFateStations.anonymousSuggestionsOpen, {})).toBe(false);
});
