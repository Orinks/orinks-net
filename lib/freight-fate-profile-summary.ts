/** The public profile trimmed to what the game speaks.
 *
 * The in-game driver profile is a spoken list: one fact per row, read once,
 * with no pagination. It has no use for a road-journal page or an
 * achievements page, and every byte it does not need is a byte the phone
 * tethering a laptop at a truck stop still has to pull. So the game's route
 * hands back the profile page's headline sections only: who the driver is,
 * the verified career snapshot, whether they are on duty, the account
 * achievement total with the most recent few, and the last three journal
 * lines.
 *
 * Nothing here is computed. Every field is the profile query's own word,
 * which is what keeps this surface exactly as public as the web page and no
 * more: a field the page does not show cannot leak through here, because the
 * query never produced it.
 */

export const FREIGHT_FATE_PROFILE_SUMMARY_EVENTS = 3;

type ProfileLike = {
  driver: unknown;
  snapshot: unknown;
  presence: unknown;
  achievementCount: unknown;
  recentAchievements: unknown;
  events?: unknown;
} | null | undefined;

export function freightFateProfileSummary(profile: ProfileLike) {
  if (!profile) return null;
  const events = Array.isArray(profile.events) ? profile.events : [];
  return {
    driver: profile.driver,
    snapshot: profile.snapshot ?? null,
    presence: profile.presence ?? null,
    achievementCount: profile.achievementCount ?? 0,
    recentAchievements: Array.isArray(profile.recentAchievements) ? profile.recentAchievements : [],
    events: events.slice(0, FREIGHT_FATE_PROFILE_SUMMARY_EVENTS),
  };
}
