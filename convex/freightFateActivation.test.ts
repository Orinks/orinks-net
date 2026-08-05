/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import {
  ACTIVATION_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  formatUserCode,
  mintUserCode,
  normalizeUserCode,
  hashDeviceCode,
} from "./freightFateActivation";
import type { MutationCtx } from "./_generated/server";

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

const SUBJECT = "user_2abcDEF";

async function driverFor(t: ReturnType<typeof setup>, subject: string) {
  return await t.withIdentity({ subject }).mutation(api.freightFate.provisionDriver, {
    displayName: "Rig Hauler",
    visibility: "public",
    now: NOW,
  });
}

describe("claimActivation", () => {
  test("binds a pending code to the signed-in driver without minting a token", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });

    const tokensBefore = await t.run(
      async (ctx) => await ctx.db.query("freightFateDeviceTokens").collect(),
    );

    const result = await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      label: "Studio desktop",
      now: NOW + 5_000,
    });

    expect(result).toEqual({ ok: true });

    const row = await t.run(
      async (ctx) => (await ctx.db.query("freightFateActivations").collect())[0],
    );
    expect(row.status).toBe("claimed");
    expect(row.driverId).toBeTruthy();
    expect(row.label).toBe("Studio desktop");

    // Claiming must not create the token -- that happens only on redeem.
    const tokensAfter = await t.run(
      async (ctx) => await ctx.db.query("freightFateDeviceTokens").collect(),
    );
    expect(tokensAfter).toHaveLength(tokensBefore.length);
  });

  test("refuses an unknown code", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const result = await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: "WKQR3468",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "unknown_code" });
  });

  test("refuses an expired code", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const result = await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      now: NOW + 11 * 60_000,
    });
    expect(result).toEqual({ ok: false, code: "unknown_code" });
  });

  test("refuses when nobody is signed in", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const result = await t.mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "not_signed_in" });
  });

  test("guessing codes is rate limited per account", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const signedIn = t.withIdentity({ subject: SUBJECT });
    // Every one of these fails as unknown_code; the point is that the limiter
    // stops the attempts rather than the codes being wrong.
    for (let i = 0; i < 10; i++) {
      const result = await signedIn.mutation(api.freightFateActivation.claimActivation, {
        userCode: "WKQR3468",
        now: NOW,
      });
      expect(result).toEqual({ ok: false, code: "unknown_code" });
    }
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    // Even a correct code is refused once the budget is spent.
    const result = await signedIn.mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "rate_limited" });
  });
});

describe("checkActivation / redeemActivation", () => {
  async function startAndClaim(t: ReturnType<typeof setup>) {
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      label: "Studio desktop",
      now: NOW,
    });
    return started;
  }

  test("reads pending before the player confirms, and writes nothing", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const hash = await hashDeviceCode(started.deviceCode);
    const before = await t.run(
      async (ctx) => (await ctx.db.query("freightFateActivations").collect())[0],
    );

    expect(
      await t.query(api.freightFateActivation.checkActivation, {
        deviceCodeHash: hash,
        now: NOW + 1_000,
      }),
    ).toBe("pending");

    const after = await t.run(
      async (ctx) => (await ctx.db.query("freightFateActivations").collect())[0],
    );
    expect(after).toEqual(before);
  });

  test("redeem mints exactly one token and consumes the row", async () => {
    const t = setup();
    const started = await startAndClaim(t);
    const hash = await hashDeviceCode(started.deviceCode);

    expect(
      await t.query(api.freightFateActivation.checkActivation, { deviceCodeHash: hash, now: NOW }),
    ).toBe("ready");

    const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
      deviceCodeHash: hash,
      now: NOW,
    });
    expect(redeemed?.token).toMatch(/^ffd_[0-9a-f]{64}$/);
    expect(redeemed?.driverId).toBeTruthy();

    const devices = await t.run(
      async (ctx) => await ctx.db.query("freightFateDeviceTokens").collect(),
    );
    expect(devices.filter((d) => d.label === "Studio desktop")).toHaveLength(1);

    const rows = await t.run(
      async (ctx) => await ctx.db.query("freightFateActivations").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("a second redeem gets nothing", async () => {
    const t = setup();
    const started = await startAndClaim(t);
    const hash = await hashDeviceCode(started.deviceCode);
    await t.mutation(api.freightFateActivation.redeemActivation, {
      deviceCodeHash: hash,
      now: NOW,
    });
    expect(
      await t.mutation(api.freightFateActivation.redeemActivation, {
        deviceCodeHash: hash,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a wrong device code never sees another player's activation", async () => {
    const t = setup();
    await startAndClaim(t);
    const wrong = await hashDeviceCode("f".repeat(64));
    expect(
      await t.query(api.freightFateActivation.checkActivation, {
        deviceCodeHash: wrong,
        now: NOW,
      }),
    ).toBe("expired");
    expect(
      await t.mutation(api.freightFateActivation.redeemActivation, {
        deviceCodeHash: wrong,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("an expired activation is never redeemable", async () => {
    const t = setup();
    const started = await startAndClaim(t);
    const hash = await hashDeviceCode(started.deviceCode);
    const late = NOW + 11 * 60_000;
    expect(
      await t.query(api.freightFateActivation.checkActivation, {
        deviceCodeHash: hash,
        now: late,
      }),
    ).toBe("expired");
    expect(
      await t.mutation(api.freightFateActivation.redeemActivation, {
        deviceCodeHash: hash,
        now: late,
      }),
    ).toBeNull();
  });

  test("a code claimed by someone else hands back that driver's name", async () => {
    const t = setup();
    // The eavesdropper, not the player, claims the code.
    await t.withIdentity({ subject: "user_2eavesdrop" }).mutation(api.freightFate.provisionDriver, {
      displayName: "Not Your Driver",
      visibility: "public",
      now: NOW,
    });
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await t
      .withIdentity({ subject: "user_2eavesdrop" })
      .mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        now: NOW,
      });

    const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
      deviceCodeHash: await hashDeviceCode(started.deviceCode),
      now: NOW,
    });
    // Documented behaviour, not a bug: the token belongs to whoever claimed.
    // The game speaks this name so the player hears that it is wrong.
    expect(redeemed?.displayName).toBe("Not Your Driver");
  });
});

describe("sweepExpiredActivations", () => {
  test("drops expired rows and leaves live ones", async () => {
    const t = setup();
    const live = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.1.1.1",
      now: NOW,
    });
    await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "2.2.2.2",
      now: NOW - 20 * 60_000,
    });

    await t.mutation(internal.freightFateActivation.sweepExpiredActivations, { now: NOW });

    const rows = await t.run(
      async (ctx) => await ctx.db.query("freightFateActivations").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userCode).toBe(live.userCode);
  });
});
