import invariants from "../data/freight-fate-profile-invariants.json";

// Temporary closed compatibility catalog copied exactly from Freight Fate's
// crates/ff-core/src/models/trailers.rs. The game invariant export must
// replace this map before staging so pricing cannot drift between repos.
export const FREIGHT_FATE_TRAILER_PRICES: Record<string, number> = {
  dry_van: 42_000,
  reefer: 82_000,
  flatbed: 48_000,
  bulk: 58_000,
  tank: 96_000,
  double_van: 74_000,
};

export const FREIGHT_FATE_ACHIEVEMENT_IDS: readonly string[] = invariants.achievementIds;
export const FREIGHT_FATE_ACHIEVEMENT_ID_SET = new Set(FREIGHT_FATE_ACHIEVEMENT_IDS);
