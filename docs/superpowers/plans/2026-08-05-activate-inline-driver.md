# Activate: collection window and inline driver creation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a near-deadline claim from stranding itself, and let a first-run player create their driver on `/activate` instead of dead-ending.

**Architecture:** Two server changes and one page change. `claimActivation` resets `expiresAt` to a short collection window when it flips a row to claimed, and gains an optional driver name so it can create the driver in the same transaction. `/activate` renders a three-field shape when the signed-in account has no driver.

**Tech Stack:** Convex (`convex-test` + vitest), Next.js App Router, Clerk, React Testing Library (jsdom, per-file `@vitest-environment` docblock).

## Global Constraints

- Repo `orinks-net`, branch `feat/activation-codes`. Do not merge to `dev` until the manual screen reader pass has run.
- Convex mutations take the caller's clock as an explicit `now: v.number()`; no `Date.now()` in a caller-invoked handler.
- `claimActivation` RETURNS a discriminated result, never throws — a throwing mutation rolls back its own rate-limiter increment, and claim's failing path is the guessing path.
- Create-and-claim is ONE mutation. Convex mutations are serializable transactions, so with all validation ahead of any write there is no half-created state. Splitting it reintroduces exactly that state.
- Drivers created on `/activate` default to visibility private.
- Comments explain WHY, matching `convex/freightFate.ts`.
- Accessibility requirements 9–16 in `.superpowers/sdd/2026-08-05-activate-inline-driver/a11y-requirements.md` are binding for Task 3 and supersede anything here that disagrees.
- Spec: `../../../Freight-fate/docs/superpowers/specs/2026-08-05-online-activation-design.md`.

## File Structure

| File | Responsibility |
| --- | --- |
| `convex/freightFateActivation.ts` (modify) | Collection-window reset; optional driver creation inside claim. |
| `convex/freightFateActivation.test.ts` (modify) | Tests for both. |
| `convex/freightFate.ts` (modify) | Export the driver-creation internals claim needs (`screenDisplayName`, `normalizeDisplayName`, `displayNameTaken`, `driverIdFromName`) if not already exported. |
| `lib/freight-fate-driver-name.ts` (create) | Shared naming-rule copy and rejection mapping, imported by both the setup page and `/activate`, so the wording cannot drift. |
| `app/activate/activate-client.tsx` (modify) | The three-field shape. |
| `app/activate/page.tsx` (modify) | Resolve driver state before first paint if a server-side pattern exists. |
| `app/activate/activate-client.test.tsx` (modify) | Tests for requirements 9–16. |

---

### Task 1: Claim resets the clock

**Files:** modify `convex/freightFateActivation.ts`, `convex/freightFateActivation.test.ts`

**Interfaces:**
- Produces: `ACTIVATION_COLLECTION_MS` (2 minutes). `claimActivation` patches `expiresAt` alongside `status`.

- [ ] **Step 1: Write the failing test**

```ts
  test("claiming near the deadline still leaves time to collect", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    // Claim with four seconds left on the original ten-minute window: the
    // exact shape of the preview run where a real claim stranded itself.
    const late = NOW + 10 * 60_000 - 4_000;
    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      now: late,
    });

    const hash = await hashDeviceCode(started.deviceCode);
    // A poll a minute after the ORIGINAL deadline must still succeed.
    const wellPast = NOW + 11 * 60_000;
    expect(
      await t.query(api.freightFateActivation.checkActivation, {
        deviceCodeHash: hash,
        now: wellPast,
      }),
    ).toBe("ready");
    const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
      deviceCodeHash: hash,
      now: wellPast,
    });
    expect(redeemed?.token).toMatch(/^ffd_[0-9a-f]{64}$/);
  });

  test("the collection window is not unlimited", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      now: NOW,
    });
    const hash = await hashDeviceCode(started.deviceCode);
    expect(
      await t.query(api.freightFateActivation.checkActivation, {
        deviceCodeHash: hash,
        now: NOW + 3 * 60_000,
      }),
    ).toBe("expired");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: the first test FAILS with `"expired"` where `"ready"` was expected — that is the bug reproduced.

- [ ] **Step 3: Implement**

Add the constant beside `ACTIVATION_TTL_MS`:

```ts
// Once claimed, the row is bound to a driver and only the holder of the
// device code can collect it, so the ten-minute guessing window has served
// its purpose. Restart a short one for collection instead: without this, a
// claim made near the original deadline strands itself -- the player is told
// "Computer connected" while the game's next poll finds an expired row.
export const ACTIVATION_COLLECTION_MS = 2 * 60_000;
```

In `claimActivation`'s patch, set the new deadline:

```ts
    await ctx.db.patch(row._id, {
      status: "claimed",
      driverId: driver.driverId,
      label: args.label,
      expiresAt: args.now + ACTIVATION_COLLECTION_MS,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run convex/freightFateActivation.test.ts` — all pass.

- [ ] **Step 5: Commit**

```bash
git add convex/freightFateActivation.ts convex/freightFateActivation.test.ts
git commit -m "fix(activation): claiming restarts a short collection window"
```

---

### Task 2: Claim creates the driver when there isn't one

**Files:** modify `convex/freightFateActivation.ts`, `convex/freightFate.ts`, `convex/freightFateActivation.test.ts`; create `lib/freight-fate-driver-name.ts`

**Interfaces:**
- Consumes: the name-screening internals in `convex/freightFate.ts`. Read `provisionDriver` first and reuse exactly what it uses — `normalizeDisplayName`, `screenDisplayName`, `displayNameTaken`, `driverIdFromName`. Export whichever are module-private; change nothing else about them.
- Produces: `claimActivation({ userCode, label?, displayName?, now })`, returning `{ ok: true }` or `{ ok: false; code }` where `code` gains `name_taken` and `name_rejected` (the latter carrying the same `reason` shape `provisionDriver` throws).

**Ordering is the correctness requirement.** Validate everything before writing anything: rate limit, then code lookup, then device cap, then name screening, and only then create the driver and patch the row. Because this is one Convex transaction, a validation failure returning `{ok:false}` must not have written a driver row — and a test must prove it.

- [ ] **Step 1: Write the failing tests**

```ts
  test("creates the driver and claims in one step", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const result = await t
      .withIdentity({ subject: "user_2brandnew" })
      .mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        displayName: "Road Star",
        label: "Studio desktop",
        now: NOW,
      });
    expect(result).toEqual({ ok: true });

    const drivers = await t.run(async (ctx) => await ctx.db.query("freightFateDrivers").collect());
    expect(drivers).toHaveLength(1);
    expect(drivers[0].displayName).toBe("Road Star");
    // A first-run page is the wrong place to ask for a public-sharing
    // decision, so a driver made here starts private.
    expect(drivers[0].visibility).toBe("private");

    const redeemed = await t.mutation(api.freightFateActivation.redeemActivation, {
      deviceCodeHash: await hashDeviceCode(started.deviceCode),
      now: NOW,
    });
    expect(redeemed?.displayName).toBe("Road Star");
  });

  test("a rejected name creates nothing at all", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const result = await t
      .withIdentity({ subject: "user_2brandnew" })
      .mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        displayName: "1234",
        now: NOW,
      });
    expect(result.ok).toBe(false);

    // The whole point of one transaction: a failure leaves no half-made state.
    const drivers = await t.run(async (ctx) => await ctx.db.query("freightFateDrivers").collect());
    expect(drivers).toHaveLength(0);
    const row = await t.run(
      async (ctx) => (await ctx.db.query("freightFateActivations").collect())[0],
    );
    expect(row.status).toBe("pending");
  });

  test("a bad code creates nothing even when the name is fine", async () => {
    const t = setup();
    const result = await t
      .withIdentity({ subject: "user_2brandnew" })
      .mutation(api.freightFateActivation.claimActivation, {
        userCode: "WKQR3468",
        displayName: "Road Star",
        now: NOW,
      });
    expect(result).toEqual({ ok: false, code: "unknown_code" });
    const drivers = await t.run(async (ctx) => await ctx.db.query("freightFateDrivers").collect());
    expect(drivers).toHaveLength(0);
  });

  test("an existing driver ignores a supplied name", async () => {
    const t = setup();
    await driverFor(t, SUBJECT);
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    await t.withIdentity({ subject: SUBJECT }).mutation(api.freightFateActivation.claimActivation, {
      userCode: started.userCode,
      displayName: "Someone Else",
      now: NOW,
    });
    const drivers = await t.run(async (ctx) => await ctx.db.query("freightFateDrivers").collect());
    expect(drivers).toHaveLength(1);
    expect(drivers[0].displayName).not.toBe("Someone Else");
  });

  test("still refuses when there is no driver and no name", async () => {
    const t = setup();
    const started = await t.mutation(api.freightFateActivation.startActivation, {
      clientKey: "1.2.3.4",
      now: NOW,
    });
    const result = await t
      .withIdentity({ subject: "user_2brandnew" })
      .mutation(api.freightFateActivation.claimActivation, {
        userCode: started.userCode,
        now: NOW,
      });
    expect(result).toEqual({ ok: false, code: "no_driver" });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run convex/freightFateActivation.test.ts`
Expected: the new tests fail — `displayName` is not yet an argument.

- [ ] **Step 3: Implement**

Restructure `claimActivation` so every read and check happens before any write, in this order: rate limit (keyed by the driver id when one exists, otherwise the Clerk subject, since a brand-new account has no driver id yet), code lookup, device cap, name screening, then the writes. Reuse `provisionDriver`'s helpers rather than reimplementing screening. Keep the existing `unknown_code` collapsing — unknown, claimed and expired stay indistinguishable.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run convex/freightFateActivation.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Extract the shared naming copy**

Create `lib/freight-fate-driver-name.ts` holding the naming-rule hint copy, the letters-required message, and the rejection-reason mapping currently living in `app/freight-fate/online/setup/setup-client.tsx`. Import it in the setup page in place of the inline copies, changing no wording. Two hand-written copies of this text will drift, and this project already treats one canonical wording per concept as load-bearing.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add convex lib app/freight-fate/online/setup
git commit -m "feat(activation): claim can create the driver in the same transaction"
```

---

### Task 3: The three-field shape on /activate

**Files:** modify `app/activate/activate-client.tsx`, `app/activate/page.tsx`, `app/activate/activate-client.test.tsx`

**Read first, and treat as binding:** `.superpowers/sdd/2026-08-05-activate-inline-driver/a11y-requirements.md`. It contains requirements 9–16 and supersedes this task where they disagree. Requirements 1–8 from the existing page still hold and must not regress.

The short version, with the detail in that file: gate rendering on driver state the way the page already gates on sign-in, using the existing single sr-only status region rather than a second one; put the name field between the code and the computer name with no fieldset; announce the shape in plain reading-order text before any field; reuse the setup page's naming rules and rejection wording from the module Task 2 extracts; extend the error focus-branch table so a name rejection focuses the name field and nothing else is marked invalid; give the three-field shape its own submit label naming both actions; and no autofocus, prefilled or not.

- [ ] **Step 1: Write the failing tests**

One test per requirement 9–16, using the "Tests that prove each" section of the a11y requirements file. Follow the existing `activate-client.test.tsx` idiom — injected `claim` prop, jsdom via the per-file docblock.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run app/activate/activate-client.test.tsx`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npm run build && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add app/activate
git commit -m "feat(activate): create a driver inline on first run"
```

---

## After the tasks

The manual screen reader pass now covers both shapes, and the shape-B path is the one to spend the most time on: it is the first-run experience, it has three fields, and its loading beat is new.

Re-run the live preview verification from the spec, including the case this work exists to fix — claim a code within a few seconds of its original ten-minute deadline and confirm the game still collects a token afterwards.
