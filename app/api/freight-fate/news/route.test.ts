/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "@/convex/schema";
import { api } from "@/convex/_generated/api";

vi.mock("next/cache", () => ({
  unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) =>
    (...args: Args) => callback(...args),
}));

const backend = vi.hoisted(() => ({ query: null as null | ((name: unknown, args: unknown) => Promise<unknown>) }));

// The route reads through the site's real cached read; the client under it
// runs the real backend query against a test database.
vi.mock("@/lib/convex", () => ({
  getConvexClient: () => (backend.query ? { query: backend.query } : null),
}));

import { GET } from "./route";

const modules = import.meta.glob("../../../../convex/**/*.ts");
const PERIOD_START = Date.UTC(2026, 10, 16, 5);
const PERIOD_END = Date.UTC(2026, 10, 23, 5);

async function publishedWorld() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("freightFatePaperEditions", {
      issue: 3, weekKey: "2026-11-16", periodStart: PERIOD_START, periodEnd: PERIOD_END,
      state: "published", builtAt: PERIOD_END, publishedAt: PERIOD_END,
      stories: [], records: [],
      standings: [{ carrierKey: "northstar", drivers: 2, loads: 5, miles: 1_200, onTimeRate: 80 }],
      backPage: ["column-01-coffee"],
    });
    await ctx.db.insert("freightFatePaperIssues", {
      issue: 3, weekKey: "2026-11-16", state: "published", publishedAt: PERIOD_END,
      periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });
  });
  backend.query = (name, args) => t.query(name as typeof api.freightFatePaper.getEdition, args as { issue?: number });
}

function get(query = "") {
  return GET(new Request(`https://orinks.net/api/freight-fate/news${query}`));
}

afterEach(() => {
  vi.unstubAllEnvs();
  backend.query = null;
});

describe("GET /api/freight-fate/news", () => {
  test("not found while the paper's flag is unset, even with an issue published", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "");
    await publishedWorld();
    const response = await get();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("with the paper on: the latest issue as spoken lines, nothing about the caller", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    await publishedWorld();
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ version: 1, issue: 3, masthead: "The Mile Marker", dates: "November 16 to 22, 2026" });
    expect(body.sections.map((row: { heading: string }) => row.heading)).toEqual(["Carrier standings", "Back page: fiction"]);
    expect(body.sections[0].lines[0]).toMatch(/: 1,200 miles, 5 loads, 2 drivers on the road, 80 percent on time\.$/);
  });

  test("one past issue by number; a malformed or missing one is not found", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    await publishedWorld();
    expect((await get("?issue=3")).status).toBe(200);
    expect((await get("?issue=4")).status).toBe(404);
    expect((await get("?issue=03")).status).toBe(404);
    expect((await get("?issue=x")).status).toBe(404);
  });

  test("no backend at all is not found", async () => {
    vi.stubEnv("FREIGHT_FATE_PAPER", "on");
    expect((await get()).status).toBe(404);
  });
});
