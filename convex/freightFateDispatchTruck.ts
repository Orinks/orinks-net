// The heartbeat's half of live dispatch: a carrier member's truck state, and
// the flag that keeps the whole feature dark until it ships.
//
// Kept apart from freightFateDispatch.ts because freightFate.ts's heartbeat
// calls into it, and freightFateDispatch.ts imports the token check from
// freightFate.ts; this file imports neither, so there is no cycle.
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Whether live dispatch is switched on for this driver.
 *
 * FREIGHT_FATE_LIVE_DISPATCH on the Convex deployment: unset (or "off") keeps
 * every dispatch call answering not_enabled and the night desk idle; "on"
 * opens it to everyone; anything else is a comma-separated list of driver
 * ids, so the owner can try it with a test driver before anyone else sees it.
 */
export function liveDispatchEnabled(driverId: string) {
  const raw = (process.env.FREIGHT_FATE_LIVE_DISPATCH ?? "").trim();
  if (!raw || raw === "off") return false;
  if (raw === "on") return true;
  return raw.split(",").map((id) => id.trim()).includes(driverId);
}

/** The driver ids the flag names, or "all", or none. */
export function liveDispatchAudience(): "all" | string[] {
  const raw = (process.env.FREIGHT_FATE_LIVE_DISPATCH ?? "").trim();
  if (!raw || raw === "off") return [];
  if (raw === "on") return "all";
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

export const truckStateValidator = v.object({
  city: v.string(),
  nextWaypoint: v.optional(v.string()),
  hosMinutesLeft: v.optional(v.number()),
  fuelPercent: v.optional(v.number()),
  cargo: v.optional(v.string()),
  loaded: v.boolean(),
});

export type TruckState = Infer<typeof truckStateValidator>;

export async function activeMembership(ctx: QueryCtx, driverId: string) {
  return await ctx.db
    .query("freightFateCarrierMembers")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId).eq("leftAt", undefined))
    .first();
}

function sameTruck(a: TruckState | undefined, b: TruckState) {
  return a !== undefined
    && a.city === b.city
    && a.nextWaypoint === b.nextWaypoint
    && a.hosMinutesLeft === b.hosMinutesLeft
    && a.fuelPercent === b.fuelPercent
    && a.cargo === b.cargo
    && a.loaded === b.loaded;
}

export type HeartbeatDispatch = { carrierId: string; openOrders: number };

/** Fold a heartbeat's truck state into the driver's carrier membership.
 *
 * Costs nothing for a driver outside a carrier beyond one index read, and
 * nothing at all while the flag is off. The member row is written only when
 * the truck actually changed, the same rule the board row follows. Returns
 * how many orders are waiting, so the game knows to fetch them without
 * polling a second endpoint.
 */
export async function foldHeartbeatIntoDispatch(
  ctx: MutationCtx,
  driverId: string,
  truck: TruckState | undefined,
  now: number,
): Promise<HeartbeatDispatch | undefined> {
  if (!liveDispatchEnabled(driverId)) return undefined;
  const member = await activeMembership(ctx, driverId);
  if (!member) return undefined;

  if (truck && !sameTruck(member.truck, truck)) {
    await ctx.db.patch(member._id, { truck, truckChangedAt: now });
  }

  const open = await ctx.db
    .query("freightFateDispatchOrders")
    .withIndex("by_driver_status", (q) => q.eq("driverId", driverId).eq("status", "open"))
    .take(50);
  return { carrierId: member.carrierId, openOrders: open.length };
}

export type MemberRow = Doc<"freightFateCarrierMembers">;
