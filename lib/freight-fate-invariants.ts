import stable from "../data/freight-fate-profile-invariants.json";
import careerTwo from "../data/freight-fate-profile-invariants-career-2.json";
import { isPostStableLine } from "./freight-fate-save-name";

// Two career lines back up here at once: the 1.9 stable line, exported into
// freight-fate-profile-invariants.json from the game's main branch, and the
// Career 2.0 line, exported into the -career-2 file from feat/career-2.0.
// A 2.0 save names itself with created_line "2.0" (and its cloud slot ends in
// " (Career 2)"); every other save, including one with no marker, is read
// against the stable export, which is what it was always read against.
//
// Facts that describe a career's own rules (which credentials a level brings,
// the level table) come from that career's line, so a 1.9 driver never
// shows a 2.0 credential. Labels and catalog prices are only ever looked up by
// a key the save already holds, so they come from both exports together:
// a 2.0 driver's regional carrier or Alaska city gets its name, and a 1.9
// save never holds those keys. The carrier pages keep reading the stable
// export alone, so they list only carriers a stable build can start with.
export type FreightFateInvariants = typeof stable;

export const STABLE_INVARIANTS: FreightFateInvariants = stable;
export const CAREER_TWO_INVARIANTS = careerTwo as FreightFateInvariants;

/** The export a save is read against, chosen by its created_line marker. */
export function invariantsForLine(createdLine: unknown): FreightFateInvariants {
  return isPostStableLine(createdLine) ? CAREER_TWO_INVARIANTS : STABLE_INVARIANTS;
}

function mergedRecord<T>(pick: (row: FreightFateInvariants) => Record<string, T>) {
  return Object.freeze({ ...pick(CAREER_TWO_INVARIANTS), ...pick(STABLE_INVARIANTS) });
}

function mergedList<T>(pick: (row: FreightFateInvariants) => readonly T[]) {
  return Object.freeze([...new Set([...pick(STABLE_INVARIANTS), ...pick(CAREER_TWO_INVARIANTS)])]);
}

/** Every key either line can hold, with its name. Stable wins a disagreement. */
export const ALL_LINES = Object.freeze({
  carrierLabels: mergedRecord((row) => row.carrierLabels as Record<string, string>),
  cityLabels: mergedRecord((row) => row.cityLabels as Record<string, string>),
  truckLabels: mergedRecord((row) => row.truckLabels as Record<string, string>),
  truckPrices: mergedRecord((row) => row.truckPrices as Record<string, number>),
  upgradePrices: mergedRecord((row) => row.upgradePrices as Record<string, number[]>),
  trailerCatalog: mergedRecord(
    (row) => row.trailerCatalog as Record<string, { label: string; purchasePrice: number }>,
  ),
  achievementIds: mergedList((row) => row.achievementIds),
  achievementLabels: mergedRecord((row) => row.achievementLabels as Record<string, string>),
  achievementDetails: mergedRecord(
    (row) => row.achievementDetails as Record<string, { category: string; description: string }>,
  ),
  profileFields: mergedList((row) => row.profileFields),
  careerFields: mergedList((row) => row.careerFields),
  truckConditionFields: mergedList((row) => row.truckConditionFields),
  sourceSaveVersion: Math.max(STABLE_INVARIANTS.sourceSaveVersion, CAREER_TWO_INVARIANTS.sourceSaveVersion),
});
