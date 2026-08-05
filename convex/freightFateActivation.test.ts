/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  ACTIVATION_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  formatUserCode,
  mintUserCode,
  normalizeUserCode,
} from "./freightFateActivation";

describe("activation codes", () => {
  test("the alphabet excludes every mishearable character", () => {
    for (const bad of ["O", "I", "L", "S", "Z", "0", "1", "2", "5"]) {
      expect(ACTIVATION_ALPHABET).not.toContain(bad);
    }
    expect(ACTIVATION_ALPHABET).toHaveLength(27);
  });

  test("minted codes use only the alphabet and are the right length", () => {
    for (let i = 0; i < 50; i++) {
      const code = mintUserCode();
      expect(code).toHaveLength(ACTIVATION_CODE_LENGTH);
      for (const char of code) {
        expect(ACTIVATION_ALPHABET).toContain(char);
      }
    }
  });

  test("formatting groups the code in fours", () => {
    expect(formatUserCode("WKQR3468")).toBe("WKQR-3468");
  });

  test("entry forgives case, dashes, and stray spaces", () => {
    expect(normalizeUserCode(" wkqr-3468 ")).toBe("WKQR3468");
    expect(normalizeUserCode("wkqr 3468")).toBe("WKQR3468");
  });

  test("entry rejects anything that is not a full code", () => {
    expect(normalizeUserCode("WKQR")).toBe("");
    expect(normalizeUserCode("WKQR-346!")).toBe("");
    expect(normalizeUserCode(null)).toBe("");
  });
});

function setup() {
  const modules = import.meta.glob("./**/*.ts");
  return convexTest(schema, modules);
}
const NOW = 1_760_000_000_000;

describe("startActivation", () => {
  test("returns a device code and a user code, and stores only the hash", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });

    expect(started.deviceCode).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeUserCode(started.userCode)).toBe(started.userCode);
    expect(started.expiresAt).toBe(NOW + 10 * 60_000);

    const rows = await t.run(async (ctx) => await ctx.db.query("freightFateActivations").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].driverId).toBeUndefined();
    // The secret itself must never appear in the row.
    expect(JSON.stringify(rows[0])).not.toContain(started.deviceCode);
  });

  test("two starts never collide on the user code", async () => {
    const t = setup();
    const a = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const b = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "5.6.7.8",
      now: NOW,
    });
    expect(a.userCode).not.toBe(b.userCode);
  });

  test("a flood from one client is rate limited", async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) {
      await t.mutation(api.freightFateActivation.startActivation, {
        clientKey: "9.9.9.9",
        now: NOW,
      });
    }
    await expect(
      t.mutation(api.freightFateActivation.startActivation, { clientKey: "9.9.9.9", now: NOW }),
    ).rejects.toThrow();
  });
});
