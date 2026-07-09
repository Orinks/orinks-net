import mutatorsData from "../data/trivia/mutators.json";

// Daily "broadcast conditions": one mutator per night, seeded from the date
// so every player gets the same twist. Effects are enforced in
// convex/trivia.ts keyed by mutator key; this module owns the catalog.

export type MutatorDef = {
  key: string;
  name: string;
  rules: string;
  intro: string; // Clyde's voiced show-open line for this condition
};

export const mutatorCatalog: MutatorDef[] = mutatorsData.mutators as MutatorDef[];
export const mutatorByKey = new Map(mutatorCatalog.map((m) => [m.key, m]));
