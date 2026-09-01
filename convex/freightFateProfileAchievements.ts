import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  FREIGHT_FATE_ACHIEVEMENT_IDS,
  FREIGHT_FATE_ACHIEVEMENT_ID_SET,
} from "./freightFateProfileCatalog";

export async function readCatalogAchievements(ctx: QueryCtx, driverId: string) {
  // The normal account needs one bounded index read. If historical invalid
  // rows push the account beyond the maximum possible valid count, fall back
  // to one exact composite-index lookup per catalog key so invalid rows can
  // neither enter the result nor displace valid rows.
  const bounded = await ctx.db.query("freightFateAchievements")
    .withIndex("by_driver", (q) => q.eq("driverId", driverId))
    .take(FREIGHT_FATE_ACHIEVEMENT_IDS.length + 1);
  if (bounded.length <= FREIGHT_FATE_ACHIEVEMENT_IDS.length) {
    return bounded.filter((row) => FREIGHT_FATE_ACHIEVEMENT_ID_SET.has(row.achievementKey));
  }

  const rows = await Promise.all(FREIGHT_FATE_ACHIEVEMENT_IDS.map(
    (achievementKey) => ctx.db.query("freightFateAchievements")
      .withIndex("by_driver_achievement", (q) =>
        q.eq("driverId", driverId).eq("achievementKey", achievementKey),
      ).unique(),
  ));
  const valid: Array<Doc<"freightFateAchievements">> = [];
  for (const row of rows) {
    if (row) valid.push(row);
  }
  return valid;
}
