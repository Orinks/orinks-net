/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  MASTODON_SHARE_WRITE_LIMIT,
  MASTODON_STATUS_LIMIT,
  OAUTH_STATE_TTL_MS,
  composeMastodonStatus,
  normalizeMastodonHost,
  parseSharePayload,
} from "./freightFateMastodon";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const SUBJECT = "user_2abcDEF";

async function provisionedDriver(t: ReturnType<typeof setup>) {
  const as = t.withIdentity({ subject: SUBJECT });
  const { driverId, token } = await as.mutation(api.freightFate.provisionDriver, {
    displayName: "Rig Hauler",
    visibility: "public",
    now: Date.now(),
  });
  return { as, driverId, tokenHash: await sha256Hex(token!) };
}

function linkFor(driverId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    driverId,
    instanceHost: "mastodon.example",
    accessToken: "access-token-1234567890",
    handle: "@hauler@mastodon.example",
    now: Date.now(),
    ...overrides,
  };
}

const NOTABLE_PAYLOAD = {
  version: 1,
  cargo: "frozen produce",
  origin: "Chicago, Illinois",
  destination: "Denver, Colorado",
  distanceMiles: 1003.4,
  onTime: true,
  reasons: [
    { type: "level", level: 3 },
    { type: "achievements", names: ["Long Haul"] },
  ],
};

describe("normalizeMastodonHost", () => {
  test("forgives the forms players actually paste", () => {
    expect(normalizeMastodonHost("mastodon.social")).toBe("mastodon.social");
    expect(normalizeMastodonHost("  HTTPS://Mastodon.Social/ ")).toBe("mastodon.social");
    expect(normalizeMastodonHost("https://mastodon.social/@hauler")).toBe("mastodon.social");
    expect(normalizeMastodonHost("@hauler@mastodon.social")).toBe("mastodon.social");
    expect(normalizeMastodonHost("hauler@mastodon.social")).toBe("mastodon.social");
  });

  test("rejects things that are not a host", () => {
    expect(normalizeMastodonHost("")).toBeNull();
    expect(normalizeMastodonHost("not a host")).toBeNull();
    expect(normalizeMastodonHost("localhost")).toBeNull();
    expect(normalizeMastodonHost(42)).toBeNull();
  });
});

describe("parseSharePayload / composeMastodonStatus", () => {
  test("accepts the game's payload and composes a tagged public post", () => {
    const parsed = parseSharePayload(NOTABLE_PAYLOAD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const status = composeMastodonStatus(parsed.payload);
    expect(status).toContain("Delivered frozen produce from Chicago, Illinois to Denver, Colorado");
    expect(status).toContain("1003 miles, on time");
    expect(status).toContain("Reached driver level 3 on arrival.");
    expect(status).toContain("Earned the Long Haul achievement.");
    expect(status.endsWith("#FreightFate")).toBe(true);
    expect(status.length).toBeLessThanOrEqual(MASTODON_STATUS_LIMIT);
  });

  test("a doctored payload cannot smuggle mentions or extra hashtags", () => {
    const parsed = parseSharePayload({
      ...NOTABLE_PAYLOAD,
      cargo: "#spam @victim beans",
      reasons: [{ type: "achievements", names: ["@admin #evil name"] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const status = composeMastodonStatus(parsed.payload);
    expect(status).not.toContain("@");
    expect(status.indexOf("#")).toBe(status.indexOf("#FreightFate"));
  });

  test("refuses reason-free (routine) deliveries and junk shapes", () => {
    expect(parseSharePayload({ ...NOTABLE_PAYLOAD, reasons: [] }).ok).toBe(false);
    expect(parseSharePayload({ ...NOTABLE_PAYLOAD, version: 2 }).ok).toBe(false);
    expect(parseSharePayload({ ...NOTABLE_PAYLOAD, distanceMiles: -5 }).ok).toBe(false);
    expect(parseSharePayload({ ...NOTABLE_PAYLOAD, reasons: [{ type: "sponsored" }] }).ok).toBe(false);
    expect(parseSharePayload(null).ok).toBe(false);
  });

  test("an oversized post is clamped and the hashtag survives", () => {
    const parsed = parseSharePayload({
      ...NOTABLE_PAYLOAD,
      cargo: "c".repeat(60),
      origin: "o".repeat(80),
      destination: "d".repeat(80),
      reasons: [{ type: "achievements", names: Array.from({ length: 10 }, (_, i) => `${"b".repeat(70)}${i}`) }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const status = composeMastodonStatus(parsed.payload);
    expect(status.length).toBeLessThanOrEqual(MASTODON_STATUS_LIMIT);
    expect(status.endsWith("#FreightFate")).toBe(true);
  });
});

describe("authorizeShare", () => {
  test("no link refuses; a saved link authorizes and hands back the token", async () => {
    const t = setup();
    const { driverId, tokenHash } = await provisionedDriver(t);
    const now = Date.now();

    const refused = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId, driverTokenHash: tokenHash, eventId: "evt-1", now,
    });
    expect(refused).toEqual({ error: "no_link" });

    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const granted = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId, driverTokenHash: tokenHash, eventId: "evt-1", now,
    });
    expect(granted).toEqual({
      instanceHost: "mastodon.example",
      accessToken: "access-token-1234567890",
    });
  });

  test("a wrong token is unauthorized", async () => {
    const t = setup();
    const { driverId } = await provisionedDriver(t);
    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const refused = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId,
      driverTokenHash: await sha256Hex("ffd_not_the_real_token_value"),
      eventId: "evt-1",
      now: Date.now(),
    });
    expect(refused).toEqual({ error: "unauthorized" });
  });

  test("a retry of the last posted event reports duplicate", async () => {
    const t = setup();
    const { driverId, tokenHash } = await provisionedDriver(t);
    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const now = Date.now();
    await t.mutation(internal.freightFateMastodon.markShared, { driverId, eventId: "evt-1", now });
    const refused = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId, driverTokenHash: tokenHash, eventId: "evt-1", now,
    });
    expect(refused).toEqual({ error: "duplicate" });
    // A new event still goes through.
    const granted = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId, driverTokenHash: tokenHash, eventId: "evt-2", now,
    });
    expect("error" in granted).toBe(false);
  });

  test("rate limits inside one window, before the token is even checked", async () => {
    const t = setup();
    const { driverId, tokenHash } = await provisionedDriver(t);
    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const now = Date.now();
    for (let i = 0; i < MASTODON_SHARE_WRITE_LIMIT; i += 1) {
      const granted = await t.mutation(internal.freightFateMastodon.authorizeShare, {
        driverId, driverTokenHash: tokenHash, eventId: `evt-${i}`, now,
      });
      expect("error" in granted).toBe(false);
    }
    const refused = await t.mutation(internal.freightFateMastodon.authorizeShare, {
      driverId, driverTokenHash: tokenHash, eventId: "evt-over", now,
    });
    expect(refused).toEqual({ error: "rate_limited" });
  });
});

describe("statusForGame", () => {
  test("answers linked-or-not for a valid token, never the access token", async () => {
    const t = setup();
    const { driverId, tokenHash } = await provisionedDriver(t);

    const before = await t.query(api.freightFateMastodon.statusForGame, {
      driverId, driverTokenHash: tokenHash,
    });
    expect(before).toEqual({ ok: true, linked: false, handle: "" });

    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const after = await t.query(api.freightFateMastodon.statusForGame, {
      driverId, driverTokenHash: tokenHash,
    });
    expect(after).toEqual({ ok: true, linked: true, handle: "@hauler@mastodon.example" });
    expect(after).not.toHaveProperty("accessToken");

    const bad = await t.query(api.freightFateMastodon.statusForGame, {
      driverId, driverTokenHash: await sha256Hex("ffd_wrong"),
    });
    expect(bad).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("OAuth state rows", () => {
  test("redeem is single-use and expires by TTL", async () => {
    const t = setup();
    const now = Date.now();
    await t.mutation(internal.freightFateMastodon.createOAuthState, {
      state: "state-abc", driverId: "rig-hauler", instanceHost: "mastodon.example", now,
    });

    const first = await t.mutation(internal.freightFateMastodon.redeemOAuthState, {
      state: "state-abc", now: now + 1000,
    });
    expect(first).toEqual({ driverId: "rig-hauler", instanceHost: "mastodon.example" });

    const second = await t.mutation(internal.freightFateMastodon.redeemOAuthState, {
      state: "state-abc", now: now + 1000,
    });
    expect(second).toBeNull();

    await t.mutation(internal.freightFateMastodon.createOAuthState, {
      state: "state-late", driverId: "rig-hauler", instanceHost: "mastodon.example", now,
    });
    const late = await t.mutation(internal.freightFateMastodon.redeemOAuthState, {
      state: "state-late", now: now + OAUTH_STATE_TTL_MS + 1,
    });
    expect(late).toBeNull();
  });
});

describe("getMyMastodonLink / unlink plumbing", () => {
  test("owner sees handle and host only; deleteLink returns the revocation facts", async () => {
    const t = setup();
    const { as, driverId } = await provisionedDriver(t);
    expect(await as.query(api.freightFateMastodon.getMyMastodonLink, {})).toBeNull();

    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    const mine = await as.query(api.freightFateMastodon.getMyMastodonLink, {});
    expect(mine).not.toBeNull();
    expect(mine!.handle).toBe("@hauler@mastodon.example");
    expect(mine!.instanceHost).toBe("mastodon.example");
    expect(mine).not.toHaveProperty("accessToken");

    const deleted = await t.mutation(internal.freightFateMastodon.deleteLink, { driverId });
    expect(deleted).toEqual({
      instanceHost: "mastodon.example",
      accessToken: "access-token-1234567890",
    });
    expect(await as.query(api.freightFateMastodon.getMyMastodonLink, {})).toBeNull();
  });

  test("relinking replaces the old row instead of stacking", async () => {
    const t = setup();
    const { driverId, tokenHash } = await provisionedDriver(t);
    await t.mutation(internal.freightFateMastodon.saveLink, linkFor(driverId));
    await t.mutation(
      internal.freightFateMastodon.saveLink,
      linkFor(driverId, { instanceHost: "other.example", handle: "@hauler@other.example" }),
    );
    const status = await t.query(api.freightFateMastodon.statusForGame, {
      driverId, driverTokenHash: tokenHash,
    });
    expect(status).toEqual({ ok: true, linked: true, handle: "@hauler@other.example" });
  });
});
