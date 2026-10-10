/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { SUGGESTION_RECEIVED_UNHEARD } from "./freightFateStationRules";

// The whole suggestion action, with the stream's host never answering: no DNS
// record, and the shipped catalog out of reach too.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  }),
}));

const modules = import.meta.glob("./**/*.ts");
const SUBJECT = "user_2suggestTest";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
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
