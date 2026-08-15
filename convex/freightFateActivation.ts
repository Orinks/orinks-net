import { mutation, query, internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { consumeFreightFateWrite } from "./freightFateRateLimit";
import {
  displayNameTaken,
  driverIdFromName,
  MAX_DEVICE_TOKENS,
  mintDeviceTokenRow,
  findDeviceRowForMachine,
  normalizeMachineKey,
  normalizeDisplayName,
} from "./freightFate";
import { screenDisplayName } from "./moderation";

// The alphanumerics minus the pairs a synthesized voice blurs together:
// O/0, I/1/L, S/5, Z/2. What is left is safe to read aloud and to type back.
export const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";
export const ACTIVATION_CODE_LENGTH = 8;
export const ACTIVATION_TTL_MS = 10 * 60_000;

// Once claimed, the row is bound to a driver and only the holder of the
// device code can collect it, so the ten-minute guessing window has served
// its purpose. Restart a short one for collection instead: without this, a
// claim made near the original deadline strands itself -- the player is told
// "Computer connected" while the game's next poll finds an expired row.
export const ACTIVATION_COLLECTION_MS = 2 * 60_000;

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

// Ten starts a minute from one address is far more than a player needs and
// far less than a script wants. There is no driver yet, so the limiter is
// keyed by whatever the route can identify the caller by.
export const ACTIVATION_START_LIMIT = 10;

// A player types one code, maybe twice after a mishearing. Ten a minute is
// generous for them and useless for guessing 27^8 possibilities.
export const ACTIVATION_CLAIM_LIMIT = 10;

// Batched so one pass cannot blow up if a flood of starts ever ages out at
// once; the hourly cron picks up whatever is left over.
export const ACTIVATION_SWEEP_BATCH = 200;

export const startActivation = mutation({
  // machineKey is the game's opaque name for the computer asking. It rides
  // the activation to the device row so that connecting the same PC again
  // replaces its entry instead of taking another slot on the list.
  args: { clientKey: v.string(), now: v.number(), machineKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "activation_start",
      driverId: args.clientKey,
      now: args.now,
      limit: ACTIVATION_START_LIMIT,
    });

    if (!allowed) {
      throw new ConvexError({ code: "rate_limited" as const });
    }

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
      machineKey: normalizeMachineKey(args.machineKey),
      createdAt: args.now,
      expiresAt,
    });

    return { deviceCode, userCode, expiresAt };
  },
});

export const claimActivation = mutation({
  args: {
    userCode: v.string(),
    label: v.optional(v.string()),
    // A first-run player has no driver yet: if the account has none and this
    // is supplied, claiming also creates it in the same transaction. An
    // account that already has a driver never has it renamed by this -- a
    // page nobody chose to land on is the wrong place for that to happen as
    // a side effect.
    displayName: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      // Two different failures the page words differently: signed out, versus
      // signed in with no driver set up yet.
      return { ok: false as const, code: "not_signed_in" as const };
    }

    const driver = await ctx.db
      .query("freightFateDrivers")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();

    // No driver and nothing to create one from: the page's signal to show
    // the name field, not a guess worth spending rate-limit budget on.
    if (!driver && !args.displayName) {
      return { ok: false as const, code: "no_driver" as const };
    }

    // Ordering below is the whole point of doing this in one mutation:
    // every read and check happens before any write, so a validation
    // failure -- returned, never thrown -- can never leave a half-created
    // driver or a claimed row behind. Convex mutations are serializable
    // transactions, which is what makes that guarantee free.

    // 1. Rate limit. Guessing is the attack this stops: a caller hammering
    // codes until one lands. Keyed by driver id when there is one; a
    // brand-new account has none yet, so the Clerk subject stands in.
    const allowed = await consumeFreightFateWrite(ctx, {
      scope: "activation_claim",
      driverId: driver ? driver.driverId : identity.subject,
      now: args.now,
      limit: ACTIVATION_CLAIM_LIMIT,
    });
    if (!allowed) {
      return { ok: false as const, code: "rate_limited" as const };
    }

    // 2. Code lookup. Unknown, already claimed, and expired are one error on
    // purpose: telling a stranger which of those a code is would let them
    // probe for live ones.
    const code = normalizeUserCode(args.userCode);
    const row = code
      ? await ctx.db
          .query("freightFateActivations")
          .withIndex("by_user_code", (q) => q.eq("userCode", code))
          .unique()
      : null;
    if (!row || row.status !== "pending" || row.expiresAt <= args.now) {
      return { ok: false as const, code: "unknown_code" as const };
    }

    // 3. Device cap. Checked here rather than at redeem so the player learns
    // about the cap while they are still looking at a browser that can
    // explain it. A brand-new driver has no computers yet, so this can only
    // ever trip for an account that already has one.
    //
    // A computer already on the list does not count against it: redeeming
    // replaces that row rather than adding one, so refusing here would lock
    // a player out of the very PC they are already signed in on.
    const replacing = driver
      ? await findDeviceRowForMachine(ctx, driver.driverId, row.machineKey)
      : null;
    const deviceCount = driver
      ? (
          await ctx.db
            .query("freightFateDeviceTokens")
            .withIndex("by_driver_id", (q) => q.eq("driverId", driver.driverId))
            .collect()
        ).length
      : 0;
    if (!replacing && deviceCount >= MAX_DEVICE_TOKENS) {
      return { ok: false as const, code: "too_many_computers" as const };
    }

    // 4. Name screening -- only when there is a driver to create. An
    // existing driver ignores a supplied name entirely: renaming someone's
    // driver is not a side effect activating a computer should ever have.
    let displayName: string | null = null;
    if (!driver) {
      displayName = normalizeDisplayName(args.displayName!);
      const verdict = screenDisplayName(displayName);
      if (!verdict.ok) {
        return { ok: false as const, code: "name_rejected" as const, reason: verdict.reason };
      }
      if (await displayNameTaken(ctx, displayName, identity.subject)) {
        return { ok: false as const, code: "name_taken" as const };
      }
    }

    // Everything above is validation. From here on, only writes -- and only
    // because every check that could fail has already run.

    let driverId: string;
    if (driver) {
      driverId = driver.driverId;
    } else {
      // Mirrors provisionDriver's brand-new-driver insert. Visibility starts
      // private: a public-sharing consent decision does not belong on a
      // first-run page someone did not choose to land on.
      let candidateId = driverIdFromName(displayName!);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await ctx.db
          .query("freightFateDrivers")
          .withIndex("by_driver_id", (q) => q.eq("driverId", candidateId))
          .unique();
        if (!clash) {
          break;
        }
        candidateId = driverIdFromName(displayName!);
      }
      driverId = candidateId;
      await ctx.db.insert("freightFateDrivers", {
        driverId,
        displayName: displayName!,
        visibility: "private",
        authSubject: identity.subject,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }

    // `now` here is the browser's clock (the /activate page sends
    // Date.now()), so it is not something to write into a deadline
    // unchecked: the sweep is the only thing that ever collects this table,
    // and a row stamped far enough ahead would simply never be collected.
    // Clamping against the server-stamped createdAt keeps the late-claim fix
    // -- a claim at T+9:59 still gets its full collection window -- while
    // bounding what any caller can write to one TTL plus one collection
    // window after the row was actually created.
    await ctx.db.patch(row._id, {
      status: "claimed",
      driverId,
      label: args.label,
      expiresAt: Math.min(
        args.now + ACTIVATION_COLLECTION_MS,
        row.createdAt + ACTIVATION_TTL_MS + ACTIVATION_COLLECTION_MS,
      ),
    });

    return { ok: true as const };
  },
});

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

    // The cap is checked again here, not just at claim. Claims are checked
    // against a count that none of them has yet changed, so a driver with
    // nine computers can start five activations, confirm all five, and mint
    // past the cap on the way out. Minting is the only place the count
    // actually moves, so it is the only place the cap can hold.
    //
    // Over the cap answers null, which the route turns into the same 410 the
    // game already handles as "that code is done, start again." A distinct
    // status would tell the player a truer story, but the game that reads
    // this contract lives in another repository and cannot be taught a new
    // one, so an honest word here would land as an unhandled response --
    // worse for the player than a wrong-but-understood one. The claim-time
    // check above is what actually explains the cap, in the browser, before
    // the player ever gets here; this path is only reachable by racing
    // claims, and the row is deleted so "expired" becomes true rather than a
    // lie the next poll would repeat.
    const replacing = await findDeviceRowForMachine(ctx, row.driverId, row.machineKey);
    const devices = await ctx.db
      .query("freightFateDeviceTokens")
      .withIndex("by_driver_id", (q) => q.eq("driverId", row.driverId!))
      .collect();
    if (!replacing && devices.length >= MAX_DEVICE_TOKENS) {
      await ctx.db.delete(row._id);
      return null;
    }
    if (replacing) {
      // This computer, connecting again -- a new build unzipped, or a
      // re-activation after signing out in the game. One computer, one row:
      // the old token stops working, which is what signing in again means.
      await ctx.db.delete(replacing._id);
    }

    const token = await mintDeviceTokenRow(
      ctx,
      row.driverId,
      row.label ?? replacing?.label,
      args.now,
      row.machineKey,
    );
    await ctx.db.delete(row._id);
    // displayName goes back so the game can say who it connected as; that
    // spoken name is the only thing standing between a claimed-by-a-stranger
    // code and a player who never notices.
    return { driverId: row.driverId, token, displayName: driver.displayName };
  },
});

// Sweep deleted in batches because a cron has no caller to take a clock from, so
// the server clock is the only clock available and correct here — this is a
// deliberate documented exception to the no-Date.now() rule.
export const sweepExpiredActivations = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("freightFateActivations")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
      .take(ACTIVATION_SWEEP_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});
