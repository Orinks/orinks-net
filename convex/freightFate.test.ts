/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

// Mirrors hashFreightFateToken in lib/freight-fate-online.ts. That helper runs
// on the game's nodejs REST route via node:crypto; SHA-256 hex over the same
// utf8 bytes is identical to this Web Crypto version, so this reproduces the
// exact hash the game's Bearer token yields at verification. If provisionDriver
// and this ever disagree, the game silently fails auth — so the round-trip
// tests below are the guardrail on that contract.
async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Local copy of normalizeFreightFateDriverId's canonicalization, used to assert
// the issued driverId round-trips unchanged when the game echoes it back.
function normalizeDriverId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const SUBJECT = "user_2abcDEF";
const OTHER = "user_2zzzZZZ";

describe("provisionDriver / getMyDriver", () => {
  test("requires authentication", async () => {
    const t = setup();
    await expect(
      t.mutation(api.freightFate.provisionDriver, {
        displayName: "Rig Hauler",
        visibility: "public",
        now: Date.now(),
      }),
    ).rejects.toThrow();
    expect(await t.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("provisions a driver keyed to the account and returns a one-time token", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const result = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "  Rig   Hauler  ",
      visibility: "public",
      now,
    });

    expect(result.rotated).toBe(false);
    expect(typeof result.token).toBe("string");
    expect(result.token!.length).toBeGreaterThanOrEqual(24);
    // The public slug is already canonical, so the game echoing it back and the
    // REST route re-normalizing it yields the same id.
    expect(normalizeDriverId(result.driverId)).toBe(result.driverId);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine).not.toBeNull();
    expect(mine!.driverId).toBe(result.driverId);
    expect(mine!.displayName).toBe("Rig Hauler"); // whitespace normalized
    expect(mine!.visibility).toBe("public");
    expect(mine!.hasToken).toBe(true);
    expect(mine).not.toHaveProperty("token"); // the plaintext token never leaks

    // A different account cannot see this driver.
    const other = t.withIdentity({ subject: OTHER });
    expect(await other.query(api.freightFate.getMyDriver, {})).toBeNull();
  });

  test("issued token authenticates the game's presence path; wrong token is rejected", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    // The game sends driverId + Bearer token; the REST route hashes the token
    // with hashFreightFateToken and calls updatePresence. Simulate that path.
    const ok = await t.mutation(api.freightFate.updatePresence, {
      driverId: normalizeDriverId(driverId),
      driverTokenHash: await sha256Hex(token!),
      activity: "Hauling reefer to Denver",
      detail: "I-70 westbound",
      now,
    });
    expect(ok.ok).toBe(true);

    const bad = await t.mutation(api.freightFate.updatePresence, {
      driverId,
      driverTokenHash: await sha256Hex("ffd_not_the_real_token_value_here"),
      activity: "x",
      detail: "y",
      now,
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unauthorized");

    // Public + on duty => listed on the live board.
    const board = await t.query(api.freightFate.getPresenceBoard, { now });
    expect(board.drivers.map((driver) => driver.driverId)).toContain(driverId);
  });

  test("a display name used by another account is rejected, case-insensitively", async () => {
    const t = setup();
    const now = Date.now();
    const first = t.withIdentity({ subject: SUBJECT });
    await first.mutation(api.freightFate.provisionDriver, {
      displayName: "Orinks",
      visibility: "public",
      now,
    });

    const second = t.withIdentity({ subject: OTHER });
    for (const clash of ["Orinks", "orinks", "  ORINKS  "]) {
      await expect(
        second.mutation(api.freightFate.provisionDriver, {
          displayName: clash,
          visibility: "private",
          now,
        }),
      ).rejects.toMatchObject({ data: { code: "name_taken" } });
    }
    // The rejected account got no driver row.
    expect(await second.query(api.freightFate.getMyDriver, {})).toBeNull();

    // A different name still works.
    const ok = await second.mutation(api.freightFate.provisionDriver, {
      displayName: "Orinks Junior",
      visibility: "private",
      now,
    });
    expect(typeof ok.token).toBe("string");

    // Renaming onto the taken name is rejected too...
    await expect(
      second.mutation(api.freightFate.provisionDriver, {
        displayName: "ORINKS",
        visibility: "private",
        now: now + 1,
      }),
    ).rejects.toMatchObject({ data: { code: "name_taken" } });

    // ...but re-saving your own unchanged name (any case) never is, so a
    // pre-existing duplicate cannot lock its owner out of the settings form.
    const resave = await second.mutation(api.freightFate.provisionDriver, {
      displayName: "orinks junior",
      visibility: "unlisted",
      now: now + 2,
    });
    expect(resave.rotated).toBe(false);
    const mine = await second.query(api.freightFate.getMyDriver, {});
    expect(mine!.visibility).toBe("unlisted");
  });

  test("re-provision edits the profile in place; token only changes when rotated", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: SUBJECT });
    const now = Date.now();

    const first = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Rig Hauler",
      visibility: "public",
      now,
    });

    // Saving a profile edit without rotating keeps the same id and token.
    const edit = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      now: now + 1,
    });
    expect(edit.driverId).toBe(first.driverId);
    expect(edit.token).toBeNull();
    expect(edit.rotated).toBe(false);

    const mine = await as.query(api.freightFate.getMyDriver, {});
    expect(mine!.displayName).toBe("Night Hauler");
    expect(mine!.visibility).toBe("private");

    const stillOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token!),
      activity: "a",
      detail: "b",
      now: now + 2,
    });
    expect(stillOk.ok).toBe(true);

    // Rotating mints a new token and invalidates the old one.
    const rotated = await as.mutation(api.freightFate.provisionDriver, {
      displayName: "Night Hauler",
      visibility: "private",
      rotateToken: true,
      now: now + 3,
    });
    expect(rotated.rotated).toBe(true);
    expect(typeof rotated.token).toBe("string");
    expect(rotated.token).not.toBe(first.token);

    const oldFails = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(first.token!),
      activity: "a",
      detail: "b",
      now: now + 4,
    });
    expect(oldFails.ok).toBe(false);

    const newOk = await t.mutation(api.freightFate.updatePresence, {
      driverId: first.driverId,
      driverTokenHash: await sha256Hex(rotated.token!),
      activity: "a",
      detail: "b",
      now: now + 5,
    });
    expect(newOk.ok).toBe(true);
  });
});
