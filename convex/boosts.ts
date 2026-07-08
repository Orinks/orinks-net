import boostsData from "../data/trivia/boosts.json";

// Effects are enforced in convex/trivia.ts keyed by boost key; this module
// only owns the catalog and pure helpers so client and server agree on
// what exists. Numbers that drive scoring live in trivia.ts with the rest
// of the game rules.

export type BoostKind = "passive" | "charges" | "nextRound" | "instant";

export type BoostDef = {
  key: string;
  name: string;
  kind: BoostKind;
  charges?: number;
  tagline: string;
  rules: string;
};

export const boostCatalog: BoostDef[] = boostsData.boosts as BoostDef[];
export const boostByKey = new Map(boostCatalog.map((b) => [b.key, b]));

/** Boosts that may be offered again even when already owned this run. */
const REPEATABLE = new Set(["spare-fuse"]);

export const BOOST_OFFER_SIZE = 3;

/**
 * Picks the round's 3-boost offer from the catalog, excluding non-repeatable
 * boosts the run already owns. roll() must be the run-seeded PRNG so daily
 * players all see the same offers. Returns fewer than 3 only when the
 * catalog is nearly exhausted (late in a very long run).
 */
export function rollBoostOffer(owned: string[], roll: (salt: string) => number, round: number): string[] {
  const ownedSet = new Set(owned);
  const pool = boostCatalog
    .map((b) => b.key)
    .filter((key) => REPEATABLE.has(key) || !ownedSet.has(key));
  const offer: string[] = [];
  for (let pick = 0; pick < BOOST_OFFER_SIZE && pool.length > 0; pick++) {
    const index = Math.floor(roll(`boost:${round}:${pick}`) * pool.length);
    offer.push(pool[index]);
    pool.splice(index, 1);
  }
  return offer;
}
