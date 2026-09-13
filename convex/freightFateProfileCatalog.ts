import invariants from "../data/freight-fate-profile-invariants.json";

type TrailerCatalogRow = { label: string; purchasePrice: number };
type AchievementDetailRow = { category: string; description: string };
type AchievementCategoryRow = { key: string; title: string };

export const FREIGHT_FATE_CAREER_TITLES: readonly string[] = invariants.careerTitles;
export const FREIGHT_FATE_CARRIER_LABELS: Readonly<Record<string, string>> =
  invariants.carrierLabels;
export const FREIGHT_FATE_TRAILER_CATALOG: Readonly<Record<string, TrailerCatalogRow>> =
  invariants.trailerCatalog;
export const FREIGHT_FATE_TRAILER_PRICES: Readonly<Record<string, number>> =
  Object.fromEntries(Object.entries(FREIGHT_FATE_TRAILER_CATALOG)
    .map(([key, trailer]) => [key, trailer.purchasePrice]));

export const FREIGHT_FATE_ACHIEVEMENT_IDS: readonly string[] = invariants.achievementIds;
export const FREIGHT_FATE_ACHIEVEMENT_ID_SET = new Set(FREIGHT_FATE_ACHIEVEMENT_IDS);
export const FREIGHT_FATE_ACHIEVEMENT_LABELS: Readonly<Record<string, string>> =
  invariants.achievementLabels;
// What each badge was for and which group it sits in, straight from the
// game's catalog. This is the only copy the profile ever shows: the name and
// description an achievement event carries are client-written and stay
// unpublished.
export const FREIGHT_FATE_ACHIEVEMENT_DETAILS: Readonly<Record<string, AchievementDetailRow>> =
  invariants.achievementDetails;
export const FREIGHT_FATE_ACHIEVEMENT_CATEGORIES: readonly AchievementCategoryRow[] =
  invariants.achievementCategories;
const ACHIEVEMENT_CATEGORY_TITLES: Readonly<Record<string, string>> =
  Object.fromEntries(FREIGHT_FATE_ACHIEVEMENT_CATEGORIES
    .map((category) => [category.key, category.title]));

/** The catalog's description and category title for a known badge. */
export function freightFateAchievementDetail(achievementKey: string) {
  const detail = FREIGHT_FATE_ACHIEVEMENT_DETAILS[achievementKey];
  if (!detail) return {};
  const category = ACHIEVEMENT_CATEGORY_TITLES[detail.category];
  return {
    description: detail.description,
    ...(category === undefined ? {} : { category }),
  };
}
