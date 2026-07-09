/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { KEEP_REVISIONS, MAX_SAVE_BYTES, MAX_SLOTS } from "./freightFateSaves";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function sha256Hex(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function saveBytes(text: string) {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

// Narrows a listSaves result to its success variant for the assertions below.
function savesOf(listed: { ok: boolean; saves?: unknown }) {
  expect(listed.ok).toBe(true);
  if (!listed.saves) {
    throw new Error("expected a successful listSaves result");
  }
  return listed.saves as {
    saveName: string;
    revision: number;
    saveVersion: number;
    contentHash: string;
    sizeBytes: number;
    summary: string;
    createdAt: number;
  }[];
}

// Provision a driver through the real account flow so the token/hash contract
// stays the one the game actually uses.
async function provisionedDriver(t: ReturnType<typeof setup>, subject = "user_2saveTest") {
  const as = t.withIdentity({ subject });
  const result = await as.mutation(api.freightFate.provisionDriver, {
    displayName: "Cloud Hauler",
    visibility: "private",
    now: Date.now(),
  });
  return {
    driverId: result.driverId,
    driverTokenHash: await sha256Hex(result.token!),
  };
}

async function upload(
  t: ReturnType<typeof setup>,
  auth: { driverId: string; driverTokenHash: string },
  overrides: Partial<{
    saveName: string;
    saveVersion: number;
    parentRevision: number | null;
    content: ArrayBuffer;
    contentHash: string;
    summary: string;
    now: number;
  }> = {},
) {
  const content = overrides.content ?? saveBytes('{"name": "Driver"}');
  return t.mutation(api.freightFateSaves.uploadSave, {
    driverId: auth.driverId,
    driverTokenHash: auth.driverTokenHash,
    saveName: overrides.saveName ?? "Driver",
    saveVersion: overrides.saveVersion ?? 3,
    parentRevision: overrides.parentRevision ?? null,
    content,
    contentHash: overrides.contentHash ?? (await sha256Hex(content)),
    summary: overrides.summary ?? "Level 3, $12,000, in Chicago",
    now: overrides.now ?? Date.now(),
  });
}

describe("uploadSave", () => {
  test("rejects an unknown driver and a wrong token", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    const unknown = await upload(t, { driverId: "no-such-driver", driverTokenHash: auth.driverTokenHash });
    expect(unknown).toMatchObject({ ok: false, reason: "driver_not_found" });

    const wrongToken = await upload(t, { driverId: auth.driverId, driverTokenHash: await sha256Hex("ffd_wrong") });
    expect(wrongToken).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  test("first upload creates revision 1 and round-trips through download", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const content = saveBytes('{"name": "Driver", "money": 12000}');

    const result = await upload(t, auth, { content });
    expect(result).toMatchObject({ ok: true, revision: 1 });

    const downloaded = await t.query(api.freightFateSaves.downloadSave, {
      ...auth,
      saveName: "Driver",
    });
    expect(downloaded.ok).toBe(true);
    expect(downloaded.revision).toBe(1);
    expect(downloaded.saveVersion).toBe(3);
    expect(new TextDecoder().decode(downloaded.content)).toBe('{"name": "Driver", "money": 12000}');
    expect(downloaded.contentHash).toBe(await sha256Hex(content));
  });

  test("verifies the content hash server-side", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    const result = await upload(t, auth, { contentHash: "0".repeat(64) });
    expect(result).toMatchObject({ ok: false, reason: "hash_mismatch" });
  });

  test("rejects empty and oversized content", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    const empty = await upload(t, auth, { content: new ArrayBuffer(0) });
    expect(empty).toMatchObject({ ok: false, reason: "too_large" });

    const oversized = await upload(t, auth, { content: new ArrayBuffer(MAX_SAVE_BYTES + 1) });
    expect(oversized).toMatchObject({ ok: false, reason: "too_large" });
  });

  test("stale parent revision is a conflict, matching parent advances the slot", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    await upload(t, auth, { summary: "first" });
    const second = await upload(t, auth, { parentRevision: 1, summary: "second" });
    expect(second).toMatchObject({ ok: true, revision: 2 });

    // A machine still on revision 1 (or one that never synced) must not
    // silently clobber revision 2.
    const stale = await upload(t, auth, { parentRevision: 1 });
    expect(stale).toMatchObject({ ok: false, reason: "conflict", latestRevision: 2, latestSummary: "second" });

    const neverSynced = await upload(t, auth, { parentRevision: null });
    expect(neverSynced).toMatchObject({ ok: false, reason: "conflict", latestRevision: 2 });
  });

  test("prunes revisions beyond the keep window, content rows included", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    const total = KEEP_REVISIONS + 3;
    for (let i = 0; i < total; i += 1) {
      const result = await upload(t, auth, { parentRevision: i === 0 ? null : i, summary: `rev ${i + 1}` });
      expect(result).toMatchObject({ ok: true, revision: i + 1 });
    }

    const saves = savesOf(await t.query(api.freightFateSaves.listSaves, auth));
    expect(saves).toHaveLength(KEEP_REVISIONS);
    const revisions = saves.map((s) => s.revision).sort((a, b) => a - b);
    expect(revisions[0]).toBe(total - KEEP_REVISIONS + 1);
    expect(revisions[revisions.length - 1]).toBe(total);

    // Pruned revisions are gone from download too, and their content rows
    // did not leak.
    const pruned = await t.query(api.freightFateSaves.downloadSave, {
      ...auth,
      saveName: "Driver",
      revision: 1,
    });
    expect(pruned).toMatchObject({ ok: false, reason: "save_not_found" });

    const contentRows = await t.run(async (ctx) => {
      return ctx.db
        .query("freightFateSaveContent")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId))
        .collect();
    });
    expect(contentRows).toHaveLength(KEEP_REVISIONS);
  });

  test("caps the number of distinct save slots per driver", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    for (let i = 0; i < MAX_SLOTS; i += 1) {
      const result = await upload(t, auth, { saveName: `Driver ${i}` });
      expect(result).toMatchObject({ ok: true, revision: 1 });
    }

    const overflow = await upload(t, auth, { saveName: "One Too Many" });
    expect(overflow).toMatchObject({ ok: false, reason: "too_many_slots" });

    // Existing slots keep accepting new revisions at the cap.
    const existing = await upload(t, auth, { saveName: "Driver 0", parentRevision: 1 });
    expect(existing).toMatchObject({ ok: true, revision: 2 });
  });
});

describe("listSaves / downloadSave", () => {
  test("requires the driver's own token", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);
    const other = await provisionedDriver(t, "user_2otherAcct");
    await upload(t, auth);

    // Another account's valid token must not read this driver's saves.
    const crossList = await t.query(api.freightFateSaves.listSaves, {
      driverId: auth.driverId,
      driverTokenHash: other.driverTokenHash,
    });
    expect(crossList).toMatchObject({ ok: false, reason: "unauthorized" });

    const crossDownload = await t.query(api.freightFateSaves.downloadSave, {
      driverId: auth.driverId,
      driverTokenHash: other.driverTokenHash,
      saveName: "Driver",
    });
    expect(crossDownload).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  test("lists every kept revision across slots, newest first", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    await upload(t, auth, { saveName: "Driver", now: 1000 });
    await upload(t, auth, { saveName: "Driver", parentRevision: 1, now: 2000 });
    await upload(t, auth, { saveName: "Night Shift", now: 3000 });

    const saves = savesOf(await t.query(api.freightFateSaves.listSaves, auth));
    expect(saves.map((s) => `${s.saveName}@${s.revision}`)).toEqual([
      "Night Shift@1",
      "Driver@2",
      "Driver@1",
    ]);
    // Metadata only — content bytes never ride along on a list.
    expect(saves[0]).not.toHaveProperty("content");
  });

  test("downloads a specific older revision for rollback", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    await upload(t, auth, { content: saveBytes("old career"), summary: "old" });
    await upload(t, auth, { parentRevision: 1, content: saveBytes("new career"), summary: "new" });

    const rollback = await t.query(api.freightFateSaves.downloadSave, {
      ...auth,
      saveName: "Driver",
      revision: 1,
    });
    expect(rollback.ok).toBe(true);
    expect(new TextDecoder().decode(rollback.content)).toBe("old career");

    const missing = await t.query(api.freightFateSaves.downloadSave, {
      ...auth,
      saveName: "No Such Slot",
    });
    expect(missing).toMatchObject({ ok: false, reason: "save_not_found" });
  });
});

describe("deleteSaveSlot", () => {
  test("removes every revision and its content", async () => {
    const t = setup();
    const auth = await provisionedDriver(t);

    await upload(t, auth);
    await upload(t, auth, { parentRevision: 1 });
    await upload(t, auth, { saveName: "Night Shift" });

    const deleted = await t.mutation(api.freightFateSaves.deleteSaveSlot, {
      ...auth,
      saveName: "Driver",
    });
    expect(deleted).toMatchObject({ ok: true, deletedRevisions: 2 });

    const saves = savesOf(await t.query(api.freightFateSaves.listSaves, auth));
    expect(saves.map((s) => s.saveName)).toEqual(["Night Shift"]);

    const contentRows = await t.run(async (ctx) => {
      return ctx.db
        .query("freightFateSaveContent")
        .withIndex("by_driver", (q) => q.eq("driverId", auth.driverId))
        .collect();
    });
    expect(contentRows).toHaveLength(1);

    // Deleting the slot resets its history: the next upload starts at
    // revision 1 with a null parent again.
    const fresh = await upload(t, auth);
    expect(fresh).toMatchObject({ ok: true, revision: 1 });
  });
});
