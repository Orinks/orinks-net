# Activation Codes (Server Half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Freight Fate install connect to an orinks.net account by showing a short activation code the player confirms in their own browser, replacing the copy-and-paste of a Driver ID and token.

**Architecture:** An RFC 8628-style device flow. The game asks for a code and receives two values: a secret `device_code` it keeps, and a short `user_code` it speaks. The player confirms the short code on `orinks.net/activate` while signed in, which binds the pending row to their driver. The game polls with the secret; the device token is minted only on the poll that consumes the row, so a plain token never rests in the database.

**Tech Stack:** Convex (schema, queries, mutations, `convex-test` + vitest), Next.js App Router route handlers, Clerk for the claim-side session, React Testing Library for the page.

## Global Constraints

- Repo `orinks-net`, branch `feat/activation-codes`. Do not push to `dev` until the manual pass in the spec passes on the branch preview.
- Convex mutations take the caller's clock as an explicit `now: v.number()` argument. Follow `provisionDriver` and `addComputer`; do not call `Date.now()` inside a handler.
- Secrets are stored as SHA-256 hex only, never in the clear. Match `hashDriverToken` in `convex/freightFate.ts` byte for byte.
- Typed failures use `ConvexError({ code: "..." })`, matching `NAME_TAKEN` and `too_many_computers`.
- Activation code alphabet is exactly `ABCDEFGHJKMNPQRTUVWXY346789` — 27 characters, the alphanumerics minus `O I L S Z 0 1 2 5`.
- Code length is 8, displayed as two groups of four (`WKQR-3468`). Expiry is 600 seconds.
- Device token count stays capped at `MAX_DEVICE_TOKENS`.
- Spec: `../../../Freight-fate/docs/superpowers/specs/2026-08-05-online-activation-design.md`.

## File Structure

| File | Responsibility |
| --- | --- |
| `convex/schema.ts` (modify) | Add the `freightFateActivations` table and its three indexes. |
| `convex/freightFate.ts` (modify) | Export `mintDeviceTokenRow` and `driverForIdentity` so the activation module can reuse them instead of duplicating token minting. |
| `convex/freightFateActivation.ts` (create) | Code generation, `startActivation`, `claimActivation`, `checkActivation`, `redeemActivation`, `sweepExpiredActivations`. |
| `convex/freightFateActivation.test.ts` (create) | Tests for all of the above. |
| `convex/crons.ts` (modify) | Add the expired-row sweep to the existing hourly job list. |
| `lib/freight-fate-online.ts` (modify) | `startFreightFateActivation` and `pollFreightFateActivation` for the REST routes. |
| `app/api/freight-fate/activate/start/route.ts` (create) | Unauthenticated start endpoint. |
| `app/api/freight-fate/activate/poll/route.ts` (create) | Poll endpoint, authenticated by `device_code` alone. |
| `app/activate/page.tsx` (create) | The short vanity route. |
| `app/activate/activate-client.tsx` (create) | Code entry form, pre-filled from `?code=`. |
| `app/activate/activate-client.test.tsx` (create) | Page tests including the accessibility requirements. |
| `app/freight-fate/online/setup/setup-client.tsx` (modify) | Remove the token display and its copy buttons; keep the computer list. |

---

### Task 1: Activation table and code generation

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/freightFateActivation.ts`
- Create: `convex/freightFateActivation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ACTIVATION_ALPHABET: string`, `ACTIVATION_CODE_LENGTH: number`, `ACTIVATION_TTL_MS: number`, `formatUserCode(raw: string): string`, `normalizeUserCode(value: unknown): string`, `mintUserCode(): string`, `hashDeviceCode(code: string): Promise<string>`, `mintDeviceCode(): string`.

- [ ] **Step 1: Write the failing test**

Create `convex/freightFateActivation.test.ts`:

```ts
/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: FAIL — cannot resolve `./freightFateActivation`.

- [ ] **Step 3: Write the code-generation module**

Create `convex/freightFateActivation.ts`:

```ts
import { ConvexError, v } from "convex/values";

// The alphanumerics minus the pairs a synthesized voice blurs together:
// O/0, I/1/L, S/5, Z/2. What is left is safe to read aloud and to type back.
export const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";
export const ACTIVATION_CODE_LENGTH = 8;
export const ACTIVATION_TTL_MS = 10 * 60_000;

// Codes are short because a player hears them; the ten-minute window and the
// fact that claiming one grants nothing on its own are what keep them safe.
export function mintUserCode() {
  const bytes = new Uint8Array(ACTIVATION_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length];
  }
  return code;
}

export function formatUserCode(raw: string) {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Accepts what a player actually types: any case, with or without the dash,
// with stray spaces. Returns "" for anything that is not a whole code, so a
// caller can treat empty as "not a code" without a second check.
export function normalizeUserCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const stripped = value.toUpperCase().replace(/[\s-]+/g, "");
  if (stripped.length !== ACTIVATION_CODE_LENGTH) {
    return "";
  }
  for (const char of stripped) {
    if (!ACTIVATION_ALPHABET.includes(char)) {
      return "";
    }
  }
  return stripped;
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// The secret the game keeps. Never displayed, never spoken, never logged.
export function mintDeviceCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Same discipline as hashDriverToken in freightFate.ts: only the hash is
// stored, so a database read never yields a usable device code.
export async function hashDeviceCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return toHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the table to the schema**

In `convex/schema.ts`, add alongside `freightFateDeviceTokens`:

```ts
  // A pending activation: the game holds the device code, the player confirms
  // the short user code on /activate. Deliberately has no lastPolledAt --
  // a write per poll is the one thing here that would move database I/O, so
  // polling reads and never writes.
  freightFateActivations: defineTable({
    deviceCodeHash: v.string(),
    userCode: v.string(),
    status: v.union(v.literal("pending"), v.literal("claimed")),
    // Set when the signed-in player claims the code.
    driverId: v.optional(v.string()),
    label: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_device_code", ["deviceCodeHash"])
    .index("by_user_code", ["userCode"])
    .index("by_expires_at", ["expiresAt"]),
```

- [ ] **Step 6: Verify the schema compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/freightFateActivation.ts convex/freightFateActivation.test.ts
git commit -m "feat(activation): activation table and spoken-safe code generation"
```

---

### Task 2: startActivation

**Files:**
- Modify: `convex/freightFateActivation.ts`
- Modify: `convex/freightFateActivation.test.ts`

**Interfaces:**
- Consumes: `mintUserCode`, `mintDeviceCode`, `hashDeviceCode`, `ACTIVATION_TTL_MS` from Task 1; `consumeFreightFateWrite(ctx, { scope, driverId, now, limit })` from `convex/freightFateRateLimit.ts`.
- Produces: `api.freightFateActivation.startActivation({ clientKey: string, now: number })` returning `{ deviceCode: string; userCode: string; expiresAt: number }`.

- [ ] **Step 1: Write the failing test**

Append to `convex/freightFateActivation.test.ts`:

```ts
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
function setup() {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: FAIL — `startActivation` is not a function on the api object.

- [ ] **Step 3: Implement startActivation**

Add to `convex/freightFateActivation.ts`:

```ts
import { mutation, query } from "./_generated/server";
import { consumeFreightFateWrite } from "./freightFateRateLimit";

// Ten starts a minute from one address is far more than a player needs and
// far less than a script wants. There is no driver yet, so the limiter is
// keyed by whatever the route can identify the caller by.
export const ACTIVATION_START_LIMIT = 10;

// A player types one code, maybe twice after a mishearing. Ten a minute is
// generous for them and useless for guessing 27^8 possibilities.
export const ACTIVATION_CLAIM_LIMIT = 10;

export const startActivation = mutation({
  args: { clientKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await consumeFreightFateWrite(ctx, {
      scope: "activation_start",
      driverId: args.clientKey,
      now: args.now,
      limit: ACTIVATION_START_LIMIT,
    });

    // Retry on collision rather than failing: a duplicate among live codes is
    // rare, and a player should never see an error for one.
    let userCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = mintUserCode();
      const clash = await ctx.db
        .query("freightFateActivations")
        .withIndex("by_user_code", (q) => q.eq("userCode", candidate))
        .unique();
      if (!clash) {
        userCode = candidate;
        break;
      }
    }
    if (!userCode) {
      throw new ConvexError({ code: "activation_unavailable" as const });
    }

    const deviceCode = mintDeviceCode();
    const expiresAt = args.now + ACTIVATION_TTL_MS;
    await ctx.db.insert("freightFateActivations", {
      deviceCodeHash: await hashDeviceCode(deviceCode),
      userCode,
      status: "pending",
      createdAt: args.now,
      expiresAt,
    });

    return { deviceCode, userCode, expiresAt };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/freightFateActivation.ts convex/freightFateActivation.test.ts
git commit -m "feat(activation): mint pending activations, rate limited per caller"
```

---

### Task 3: claimActivation

**Files:**
- Modify: `convex/freightFate.ts` (export two existing helpers)
- Modify: `convex/freightFateActivation.ts`
- Modify: `convex/freightFateActivation.test.ts`

**Interfaces:**
- Consumes: `driverForIdentity(ctx)` and `MAX_DEVICE_TOKENS` from `convex/freightFate.ts`.
- Produces: `api.freightFateActivation.claimActivation({ userCode: string, label?: string, now: number })` returning `{ ok: true }`. Throws `ConvexError` with `code` of `not_signed_in`, `no_driver`, `unknown_code`, or `too_many_computers`.

- [ ] **Step 1: Export the helper the claim needs**

In `convex/freightFate.ts`, change `async function driverForIdentity(` to `export async function driverForIdentity(`. Leave everything else alone.

- [ ] **Step 2: Write the failing test**

Append to `convex/freightFateActivation.test.ts`:

```ts
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

    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      label: "Studio desktop",
      now: NOW + 5_000,
    });

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
    await expect(
      t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
        userCode: "WKQR3468",
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  test("refuses an expired code", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await expect(
      t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        now: NOW + 11 * 60_000,
      }),
    ).rejects.toThrow();
  });

  test("refuses when nobody is signed in", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await expect(
      t.mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  test("guessing codes is rate limited per account", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const signedIn = t.withIdentity({ subject: SUBJECT });
    // Every one of these fails as unknown_code; the point is that the limiter
    // stops the attempts rather than the codes being wrong.
    for (let i = 0; i < 10; i++) {
      await expect(
        signedIn.mutation(api.freightFateActivation.claimActivation, {
          userCode: "WKQR3468",
          now: NOW,
        }),
      ).rejects.toThrow();
    }
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    // Even a correct code is refused once the budget is spent.
    await expect(
      signedIn.mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        now: NOW,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: FAIL — `claimActivation` is not a function.

- [ ] **Step 4: Implement claimActivation**

Add to `convex/freightFateActivation.ts`:

```ts
import { driverForIdentity, MAX_DEVICE_TOKENS } from "./freightFate";

export const claimActivation = mutation({
  args: { userCode: v.string(), label: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const driver = await driverForIdentity(ctx);
    if (!driver) {
      // Two different failures the page words differently: signed out, versus
      // signed in with no driver set up yet.
      const identity = await ctx.auth.getUserIdentity();
      throw new ConvexError({ code: identity ? ("no_driver" as const) : ("not_signed_in" as const) });
    }

    // Guessing is the attack this stops: a signed-in caller hammering codes
    // until one lands. Keyed by account, since that is what a claim needs.
    await consumeFreightFateWrite(ctx, {
      scope: "activation_claim",
      driverId: driver.driverId,
      now: args.now,
      limit: ACTIVATION_CLAIM_LIMIT,
    });

    const code = normalizeUserCode(args.userCode);
    const row = code
      ? await ctx.db
          .query("freightFateActivations")
          .withIndex("by_user_code", (q) => q.eq("userCode", code))
          .unique()
      : null;

    // Unknown, already claimed, and expired are one error on purpose: telling
    // a stranger which of those a code is would let them probe for live ones.
    if (!row || row.status !== "pending" || row.expiresAt <= args.now) {
      throw new ConvexError({ code: "unknown_code" as const });
    }

    const devices = await ctx.db
      .query("freightFateDeviceTokens")
      .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
      .collect();
    // Checked here rather than at redeem so the player learns about the cap
    // while they are still looking at a browser that can explain it.
    if (devices.length >= MAX_DEVICE_TOKENS) {
      throw new ConvexError({ code: "too_many_computers" as const, limit: MAX_DEVICE_TOKENS });
    }

    await ctx.db.patch(row._id, {
      status: "claimed",
      driverId: driver.driverId,
      label: args.label,
    });

    return { ok: true as const };
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/freightFate.ts convex/freightFateActivation.ts convex/freightFateActivation.test.ts
git commit -m "feat(activation): claim a code against the signed-in driver"
```

---

### Task 4: checkActivation and redeemActivation

**Files:**
- Modify: `convex/freightFate.ts` (export one more helper)
- Modify: `convex/freightFateActivation.ts`
- Modify: `convex/freightFateActivation.test.ts`

**Interfaces:**
- Consumes: `mintDeviceTokenRow(ctx, driverId, label, now)` from `convex/freightFate.ts`; `hashDeviceCode` from Task 1.
- Produces: `api.freightFateActivation.checkActivation({ deviceCodeHash: string, now: number })` returning `"pending" | "ready" | "expired"`, and `api.freightFateActivation.redeemActivation({ deviceCodeHash: string, now: number })` returning `{ driverId: string; token: string; displayName: string } | null`.

`displayName` exists because of the spec's "what the two codes do not protect
against": the game speaks the name it connected as, so a player who had their
code claimed by someone else hears a stranger's name immediately.

- [ ] **Step 1: Export the token minter**

In `convex/freightFate.ts`, change `async function mintDeviceTokenRow(` to `export async function mintDeviceTokenRow(`.

- [ ] **Step 2: Write the failing test**

Append to `convex/freightFateActivation.test.ts`:

```ts
import { hashDeviceCode } from "./freightFateActivation";

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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: FAIL — `checkActivation` is not a function.

- [ ] **Step 4: Implement both**

Add to `convex/freightFateActivation.ts`:

```ts
import { mintDeviceTokenRow } from "./freightFate";

// The waiting poll. A query, not a mutation, and it writes nothing: this runs
// every few seconds for up to ten minutes per setup, so it is the one call
// here whose cost is worth designing around.
export const checkActivation = query({
  args: { deviceCodeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("freightFateActivations")
      .withIndex("by_device_code", (q) => q.eq("deviceCodeHash", args.deviceCodeHash))
      .unique();
    // A missing row and an expired one are the same answer: the game's
    // recovery is identical either way, and it has already been consumed in
    // the successful case.
    if (!row || row.expiresAt <= args.now) {
      return "expired" as const;
    }
    return row.status === "claimed" ? ("ready" as const) : ("pending" as const);
  },
});

// The only call that mints. Minting here rather than at claim is what keeps a
// plain token out of the database: it exists for exactly one response, and
// the row is deleted in the same transaction so it cannot be minted twice.
export const redeemActivation = mutation({
  args: { deviceCodeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("freightFateActivations")
      .withIndex("by_device_code", (q) => q.eq("deviceCodeHash", args.deviceCodeHash))
      .unique();
    if (!row || row.status !== "claimed" || !row.driverId || row.expiresAt <= args.now) {
      return null;
    }
    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId!))
      .unique();
    if (!driver) {
      return null;
    }
    const token = await mintDeviceTokenRow(ctx, row.driverId, row.label, args.now);
    await ctx.db.delete(row._id);
    // displayName goes back so the game can say who it connected as; that
    // spoken name is the only thing standing between a claimed-by-a-stranger
    // code and a player who never notices.
    return { driverId: row.driverId, token, displayName: driver.displayName };
  },
});
```

Add this test alongside the others in the same describe block, covering the
case the spec calls out:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/freightFate.ts convex/freightFateActivation.ts convex/freightFateActivation.test.ts
git commit -m "feat(activation): poll by device code, mint the token only on redeem"
```

---

### Task 5: Expired-row sweep

**Files:**
- Modify: `convex/freightFateActivation.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/freightFateActivation.test.ts`

**Interfaces:**
- Produces: `internal.freightFateActivation.sweepExpiredActivations({ now: number })`.

- [ ] **Step 1: Write the failing test**

Append to `convex/freightFateActivation.test.ts`:

```ts
import { internal } from "./_generated/api";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: FAIL — `sweepExpiredActivations` is not a function.

- [ ] **Step 3: Implement the sweep**

Add to `convex/freightFateActivation.ts`:

```ts
import { internalMutation } from "./_generated/server";

// Batched so one pass cannot blow up if a flood of starts ever ages out at
// once; the hourly cron picks up whatever is left over.
export const ACTIVATION_SWEEP_BATCH = 200;

export const sweepExpiredActivations = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query("freightFateActivations")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", args.now))
      .take(ACTIVATION_SWEEP_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Register the cron**

In `convex/crons.ts`, add before `export default crons;`:

```ts
// Activation rows live ten minutes and are deleted the moment they are
// redeemed, so all this sweeps is codes nobody finished. Hourly is plenty
// against a ten-minute life, and the pass is batched.
crons.interval(
  "drop expired Freight Fate activations",
  { hours: 1 },
  internal.freightFateActivation.sweepExpiredActivations,
  {},
);
```

Note: the cron passes no `now`. Change the handler's args to `{ now: v.optional(v.number()) }` and open with `const now = args.now ?? Date.now();` — a cron has no caller clock to pass, and this is the one place a server clock is correct.

- [ ] **Step 6: Verify tests and types still pass**

Run: `npx vitest run convex/freightFateActivation.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add convex/freightFateActivation.ts convex/crons.ts convex/freightFateActivation.test.ts
git commit -m "feat(activation): sweep expired activation rows hourly"
```

---

### Task 6: REST routes

**Files:**
- Modify: `lib/freight-fate-online.ts`
- Create: `app/api/freight-fate/activate/start/route.ts`
- Create: `app/api/freight-fate/activate/poll/route.ts`

**Interfaces:**
- Consumes: `getConvexClient()` from `@/lib/convex`; `startActivation`, `checkActivation`, `redeemActivation` from Tasks 2 and 4; `hashDeviceCode` from Task 1.
- Produces: HTTP contract the game plan depends on —
  `POST /api/freight-fate/activate/start` → `200 { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }`
  `POST /api/freight-fate/activate/poll` with `{ device_code }` → `200 { status: "pending" }`, `200 { status: "ready", driver_id, token, display_name }`, or `410 { status: "expired" }`.

- [ ] **Step 1: Add the lib functions**

Append to `lib/freight-fate-online.ts`:

```ts
// Poll spacing the game starts from; it backs off from here on its own.
export const FREIGHT_FATE_ACTIVATION_INTERVAL_S = 3;

export async function startFreightFateActivation(input: { clientKey: string; siteOrigin: string }) {
  const client = getConvexClient();
  if (!client) {
    return null;
  }
  const started = await client.mutation(anyApi.freightFateActivation.startActivation, {
    clientKey: input.clientKey.slice(0, 64),
    now: Date.now(),
  });
  const formatted = `${started.userCode.slice(0, 4)}-${started.userCode.slice(4)}`;
  const verificationUri = `${input.siteOrigin}/activate`;
  return {
    device_code: started.deviceCode,
    user_code: formatted,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${formatted}`,
    expires_in: Math.max(0, Math.round((started.expiresAt - Date.now()) / 1000)),
    interval: FREIGHT_FATE_ACTIVATION_INTERVAL_S,
  };
}

export async function pollFreightFateActivation(input: { deviceCode: string }) {
  const client = getConvexClient();
  if (!client) {
    return null;
  }
  // Hashed here, on the server, so the stored value and the polled value are
  // produced by the same helper the game never sees.
  const deviceCodeHash = hashFreightFateToken(input.deviceCode);
  const status = await client.query(anyApi.freightFateActivation.checkActivation, {
    deviceCodeHash,
    now: Date.now(),
  });
  if (status !== "ready") {
    return { status } as const;
  }
  const redeemed = await client.mutation(anyApi.freightFateActivation.redeemActivation, {
    deviceCodeHash,
    now: Date.now(),
  });
  // Lost a race with another poll holding the same secret: the row is gone
  // and the token went to that caller. Expired is the honest answer.
  if (!redeemed) {
    return { status: "expired" } as const;
  }
  return {
    status: "ready",
    driverId: redeemed.driverId,
    token: redeemed.token,
    displayName: redeemed.displayName,
  } as const;
}
```

Note: `hashFreightFateToken` is `sha256` hex over utf8, identical to `hashDeviceCode`'s Web Crypto version. Both must stay identical or every poll fails to find its row — this is the same contract `hashDriverToken` already documents.

- [ ] **Step 2: Create the start route**

Create `app/api/freight-fate/activate/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import { startFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  try {
    const started = await startFreightFateActivation({
      clientKey: clientKey(request),
      siteOrigin: new URL(request.url).origin,
    });
    if (!started) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json(started);
  } catch {
    // The only expected throw here is the rate limiter.
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
}
```

- [ ] **Step 3: Create the poll route**

Create `app/api/freight-fate/activate/poll/route.ts`:

```ts
import { NextResponse } from "next/server";
import { pollFreightFateActivation } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { device_code?: unknown };
    const deviceCode = typeof body.device_code === "string" ? body.device_code : "";
    if (!/^[0-9a-f]{64}$/.test(deviceCode)) {
      return NextResponse.json({ status: "expired" }, { status: 410 });
    }
    const result = await pollFreightFateActivation({ deviceCode });
    if (!result) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (result.status === "expired") {
      return NextResponse.json({ status: "expired" }, { status: 410 });
    }
    if (result.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }
    return NextResponse.json({
      status: "ready",
      driver_id: result.driverId,
      token: result.token,
      display_name: result.displayName,
    });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Verify the build and types**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add lib/freight-fate-online.ts app/api/freight-fate/activate
git commit -m "feat(activation): start and poll REST endpoints for the game"
```

---

### Task 7: The /activate page

**Files:**
- Create: `app/activate/page.tsx`
- Create: `app/activate/activate-client.tsx`
- Create: `app/activate/activate-client.test.tsx`

**Interfaces:**
- Consumes: `api.freightFateActivation.claimActivation` from Task 3.
- Produces: the route the game sends players to.

Read `app/freight-fate/online/setup/setup-client.tsx` first and follow its Clerk usage, its Convex `useMutation` usage, and its error-rendering shape. Match that file rather than inventing a new pattern.

**Accessibility requirements — these are acceptance criteria, not suggestions:**
- Both fields have a real `<label>` bound by `htmlFor`/`id`.
- The submit control is a `<button type="submit">` inside a `<form>`, reachable and operable by keyboard alone.
- Errors render in an element referenced by the code field's `aria-describedby` and inside `role="alert"` so they are announced.
- Success renders inside `role="status"`.
- Nothing conveys state by color or position alone.

- [ ] **Step 1: Write the failing test**

Create `app/activate/activate-client.test.tsx`, following the existing `setup-client.test.tsx` for how Clerk and Convex are mocked:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ActivateClient from "./activate-client";

describe("ActivateClient", () => {
  test("pre-fills the code from the query string", () => {
    render(<ActivateClient initialCode="WKQR-3468" claim={vi.fn()} />);
    expect(screen.getByLabelText(/activation code/i)).toHaveValue("WKQR-3468");
  });

  test("labels both fields and submits what was typed", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient initialCode="" claim={claim} />);

    fireEvent.change(screen.getByLabelText(/activation code/i), {
      target: { value: "wkqr-3468" },
    });
    fireEvent.change(screen.getByLabelText(/name this computer/i), {
      target: { value: "Studio desktop" },
    });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith({ userCode: "wkqr-3468", label: "Studio desktop" }),
    );
  });

  test("announces success in a live region", async () => {
    render(<ActivateClient initialCode="WKQR-3468" claim={vi.fn().mockResolvedValue({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/return to freight fate/i);
  });

  test("announces an unknown code as an alert tied to the field", async () => {
    const claim = vi.fn().mockRejectedValue({ data: { code: "unknown_code" } });
    render(<ActivateClient initialCode="WKQR-3468" claim={claim} />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/expired|not recognised|not recognized/i);
    expect(screen.getByLabelText(/activation code/i)).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/activate/activate-client.test.tsx`
Expected: FAIL — cannot resolve `./activate-client`.

- [ ] **Step 3: Implement the client component**

Create `app/activate/activate-client.tsx`. It takes `initialCode` and an injected `claim` so the tests need no Convex provider:

```tsx
"use client";

import { useId, useState } from "react";

type ClaimFn = (input: { userCode: string; label?: string }) => Promise<{ ok: true }>;

const MESSAGES: Record<string, string> = {
  unknown_code:
    "That code was not recognised, or it has expired. Codes last ten minutes. Start setup again in Freight Fate to get a new one.",
  not_signed_in: "Sign in first, then enter your code again.",
  no_driver: "Set up your driver on the Freight Fate setup page first, then come back here.",
  too_many_computers:
    "You have connected the maximum number of computers. Remove one on the setup page, then try again.",
};

export default function ActivateClient({
  initialCode,
  claim,
}: {
  initialCode: string;
  claim: ClaimFn;
}) {
  const codeId = useId();
  const labelId = useId();
  const errorId = useId();
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await claim({ userCode: code, label: label.trim() || undefined });
      setDone(true);
    } catch (thrown) {
      const code = (thrown as { data?: { code?: string } })?.data?.code ?? "";
      setError(MESSAGES[code] ?? "Something went wrong. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status">
        <h1>Computer connected</h1>
        <p>You can return to Freight Fate. It will say when it is connected.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Activate Freight Fate</h1>
      <p>Enter the activation code Freight Fate is showing on this computer.</p>

      <label htmlFor={codeId}>Activation code</label>
      <input
        id={codeId}
        name="code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        aria-describedby={error ? errorId : undefined}
      />

      <label htmlFor={labelId}>Name this computer</label>
      <input
        id={labelId}
        name="label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="My computer"
        autoComplete="off"
      />

      {error ? (
        <p id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy}>
        {busy ? "Connecting" : "Connect this computer"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/activate/activate-client.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the route**

Create `app/activate/page.tsx`. It reads `?code=`, requires a Clerk session the way the setup page does, and passes a `claim` that calls `useMutation(api.freightFateActivation.claimActivation)` with `now: Date.now()`. Copy the sign-in gate and the Convex provider usage from `app/freight-fate/online/setup/page.tsx` verbatim rather than writing a new one.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: succeeds, and `/activate` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add app/activate
git commit -m "feat(activation): the /activate page players confirm their code on"
```

---

### Task 8: Retire the token copy affordance

**Files:**
- Modify: `app/freight-fate/online/setup/setup-client.tsx`
- Modify: `app/freight-fate/online/setup/setup-client.test.tsx`

- [ ] **Step 1: Find what to remove**

Run: `grep -n "clipboard\|Copy\|token" app/freight-fate/online/setup/setup-client.tsx`

Remove the UI that displays a freshly minted token and the buttons that copy it or the Driver ID. Keep the computer list, its add and remove controls, and the legacy-token entry — those still manage real state.

- [ ] **Step 2: Update the tests**

Delete the assertions covering the copy buttons and the token display. Add one that pins the new behavior:

```tsx
test("does not display a driver token", async () => {
  renderSetup();
  expect(screen.queryByText(/ffd_/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Point players at the new flow**

Where the page previously told players to copy values into the game, replace the copy with an instruction that matches reality: open Freight Fate, choose "Set up this computer with orinks.net", and enter the code it gives you at `orinks.net/activate`.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/freight-fate/online/setup
git commit -m "feat(activation): stop showing driver tokens on the setup page"
```

---

## Manual verification on the branch preview

After Task 8, push the branch and walk the manual pass from the spec against the preview URL. The branch inherits the preview deploy key from the bare Preview scope, so it gets its own Convex deployment, which starts empty — provisioning a driver from nothing is step one, not a problem.

Clerk's development instance is in test mode: sign in with `you+clerk_test@example.com` and the code `424242`.

1. Start an activation with `curl -X POST <preview>/api/freight-fate/activate/start`; confirm a code comes back.
2. Poll once; confirm `pending`.
3. Open `<preview>/activate?code=<the code>`, sign in, name the computer, confirm.
4. Poll again; confirm `ready` with a `driver_id` and an `ffd_` token.
5. Poll a third time; confirm `410 expired`.
6. Confirm the computer appears in the setup page's list under the name given.
