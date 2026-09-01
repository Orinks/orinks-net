import invariants from "../data/freight-fate-profile-invariants.json";

type TrailerCatalogRow = { label: string; purchasePrice: number };

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
