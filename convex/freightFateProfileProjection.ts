import type { Doc } from "./_generated/dataModel";
import invariants from "../data/freight-fate-profile-invariants.json";
import {
  FREIGHT_FATE_CAREER_TITLES,
  FREIGHT_FATE_CARRIER_LABELS,
  FREIGHT_FATE_TRAILER_PRICES,
} from "./freightFateProfileCatalog";

type JsonObject = Record<string, unknown>;

const EMPLOYMENT_LABELS = {
  company_driver: "Company driver",
  leased_owner_operator: "Leased-on owner-operator",
  independent_authority: "Own authority",
} as const;

type BusinessStatus = keyof typeof EMPLOYMENT_LABELS;

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

export function levelForXp(xp: number) {
  const thresholds = invariants.levelXp as number[];
  let level = 1;
  for (let index = 1; index < thresholds.length; index += 1) {
    if (xp >= thresholds[index]) level = index + 1;
  }
  return level;
}

function businessStatusOf(value: unknown): BusinessStatus | undefined {
  return typeof value === "string" && value in EMPLOYMENT_LABELS
    ? value as BusinessStatus
    : undefined;
}

function safetyRecord(payload: JsonObject) {
  const record = payload.driving_record as JsonObject | undefined;
  const stats = payload.achievement_stats as JsonObject;
  if (!record
    || !Array.isArray(record.serious_violations)
    || !Array.isArray(record.major_offenses)
    || !Number.isInteger(record.citations)
    || !Number.isInteger(record.fatigue_events)
    || !Number.isInteger(record.carrier_terminations)
    || !Number.isInteger(record.repossessions)) return undefined;
  return {
    citations: record.citations as number,
    seriousViolations: record.serious_violations.length,
    majorOffenses: record.major_offenses.length,
    fatigueEvents: record.fatigue_events as number,
    ...(Number.isInteger(stats.cargo_claims)
      ? { cargoClaims: stats.cargo_claims as number }
      : {}),
    ...(Number.isInteger(stats.preventable_equipment_damage)
      ? { preventableEquipmentDamage: stats.preventable_equipment_damage as number }
      : {}),
    carrierTerminations: record.carrier_terminations as number,
    repossessions: record.repossessions as number,
  };
}

function netWorthProjection(payload: JsonObject, businessStatus?: BusinessStatus) {
  if (!businessStatus || !Array.isArray(payload.owned_trucks)
    || !Array.isArray(payload.owned_trailers)) return {};

  const truckPrices = invariants.truckPrices as Record<string, number>;
  const activeTruck = payload.truck as string;
  const assignedTruck = businessStatus === "company_driver" ? activeTruck : undefined;
  const ownedTrucks = (payload.owned_trucks as string[])
    .filter((truck) => truck !== assignedTruck);
  let equipmentValue = ownedTrucks.reduce((total, truck) => total + truckPrices[truck], 0);
  equipmentValue += (payload.owned_trailers as string[]).reduce(
    (total, trailer) => total + FREIGHT_FATE_TRAILER_PRICES[trailer],
    0,
  );

  // The save's upgrade tiers belong to the active tractor. Carrier-assigned
  // upgrades are not the player's asset; owned active equipment gets every
  // paid tier included in its catalog value.
  if (ownedTrucks.includes(activeTruck)) {
    const upgradePrices = invariants.upgradePrices as Record<string, number[]>;
    for (const [key, tier] of Object.entries(payload.upgrades as JsonObject)) {
      equipmentValue += (upgradePrices[key] ?? []).slice(0, tier as number)
        .reduce((total, price) => total + price, 0);
    }
  }
  return {
    netWorth: Math.round((payload.money as number) + equipmentValue),
    netWorthComplete: true,
  };
}

export function buildVerifiedProfileSnapshot(args: {
  driverId: string;
  saveName: string;
  revision: number;
  payload: JsonObject;
  now: number;
  validatorVersion: number;
  meaningfulPlayedAt?: number;
}) {
  const career = args.payload.career as JsonObject;
  const stats = args.payload.achievement_stats as JsonObject;
  const level = levelForXp(career.xp as number);
  const businessStatus = businessStatusOf(args.payload.business_status);
  const employmentStatus = businessStatus
    ? EMPLOYMENT_LABELS[businessStatus]
    : "Owner-operator";
  const carrierName = businessStatus === "independent_authority"
    ? undefined
    : FREIGHT_FATE_CARRIER_LABELS[args.payload.carrier_key as string];
  const businessIdentity = businessStatus === "company_driver" && carrierName
    ? `${employmentStatus} for ${carrierName}`
    : businessStatus === "leased_owner_operator" && carrierName
      ? `${employmentStatus} with ${carrierName}`
      : businessStatus ? employmentStatus : undefined;
  const deliveries = career.deliveries as number;
  const damageFree = deliveries > 0 && Number.isInteger(stats.damage_free_deliveries)
    ? stats.damage_free_deliveries as number
    : undefined;
  const longestHaul = typeof stats.longest_haul_miles === "number"
    && stats.longest_haul_miles > 0
    ? roundOne(stats.longest_haul_miles)
    : undefined;
  const cities = Array.isArray(stats.cities_delivered)
    ? stats.cities_delivered as string[]
    : undefined;
  const cityLabels = invariants.cityLabels as Record<string, string>;
  const states = cities
    ? new Set(cities.map((city) => cityLabels[city].split(", ").at(-1)))
    : undefined;
  const fleetTiers = invariants.fleetTiers as Array<{ minLevel: number; label: string }>;
  const fleetTier = businessStatus === "company_driver"
    ? fleetTiers.filter((tier) => level >= tier.minLevel).at(-1)?.label
    : undefined;
  const endorsementDefs = invariants.endorsements as Record<
    string,
    { level?: number; label: string }
  >;
  const purchased = Array.isArray(career.purchased_endorsements)
    ? career.purchased_endorsements as unknown[]
    : [];
  const endorsements = Object.entries(endorsementDefs)
    .filter(([key, def]) => (def.level !== undefined && level >= def.level)
      || purchased.includes(key))
    .sort(([, a], [, b]) => (a.level ?? Number.MAX_SAFE_INTEGER)
      - (b.level ?? Number.MAX_SAFE_INTEGER))
    .map(([, def]) => def.label);
  const truckLabels = invariants.truckLabels as Record<string, string>;
  const safety = safetyRecord(args.payload);

  return {
    driverId: args.driverId,
    version: 1,
    saveName: args.saveName,
    ...(businessStatus ? { businessStatus } : {}),
    ...(businessIdentity ? { businessIdentity } : {}),
    ...(carrierName ? { carrierName } : {}),
    level,
    careerTitle: businessStatus
      ? FREIGHT_FATE_CAREER_TITLES[
        Math.min(level, FREIGHT_FATE_CAREER_TITLES.length) - 1
      ]
      : `Level ${level} driver`,
    lastSavedCity: cityLabels[args.payload.current_city as string],
    deliveries,
    milesDriven: roundOne(career.total_miles as number),
    reputation: roundOne(career.reputation as number),
    onTimeDeliveries: career.on_time_deliveries as number,
    ...(deliveries > 0
      ? { onTimeRate: roundOne((career.on_time_deliveries as number) * 100 / deliveries) }
      : {}),
    ...(damageFree === undefined ? {} : {
      damageFreeDeliveries: damageFree,
      damageFreeRate: roundOne(damageFree * 100 / deliveries),
    }),
    ...(longestHaul === undefined ? {} : { longestHaulMiles: longestHaul }),
    ...(cities ? { citiesVisited: cities.length, statesVisited: states!.size } : {}),
    truckName: truckLabels[args.payload.truck as string],
    ...(businessStatus ? { truckIsCarrierAssigned: businessStatus === "company_driver" } : {}),
    employmentStatus,
    ...(safety ? { safetyRecord: safety } : {}),
    lifetimeEarnings: Math.round(career.total_earnings as number),
    ...netWorthProjection(args.payload, businessStatus),
    badgesEarned: (args.payload.achievements as unknown[]).length,
    endorsements,
    ...(fleetTier ? { fleetTier } : {}),
    capturedAt: args.now,
    updatedAt: args.now,
    sourceSaveName: args.saveName,
    sourceRevision: args.revision,
    validatorVersion: args.validatorVersion,
    ...(args.meaningfulPlayedAt === undefined
      ? {}
      : { meaningfulPlayedAt: args.meaningfulPlayedAt }),
  };
}

export function publicVerifiedSnapshot(
  snapshot: Doc<"freightFateProfileSnapshots"> | null,
) {
  if (!snapshot?.sourceRevision || !snapshot.validatorVersion) return null;
  return {
    version: snapshot.version,
    saveName: snapshot.saveName,
    businessStatus: snapshot.businessStatus,
    businessIdentity: snapshot.businessIdentity,
    carrierName: snapshot.carrierName,
    level: snapshot.level,
    careerTitle: snapshot.careerTitle,
    lastSavedCity: snapshot.lastSavedCity,
    deliveries: snapshot.deliveries,
    milesDriven: snapshot.milesDriven,
    reputation: snapshot.reputation,
    onTimeDeliveries: snapshot.onTimeDeliveries,
    onTimeRate: snapshot.onTimeRate,
    damageFreeDeliveries: snapshot.damageFreeDeliveries,
    damageFreeRate: snapshot.damageFreeRate,
    citiesVisited: snapshot.citiesVisited,
    statesVisited: snapshot.statesVisited,
    longestHaulMiles: snapshot.longestHaulMiles,
    safetyRecord: snapshot.safetyRecord,
    truckName: snapshot.truckName,
    truckIsCarrierAssigned: snapshot.truckIsCarrierAssigned,
    employmentStatus: snapshot.employmentStatus,
    lifetimeEarnings: snapshot.lifetimeEarnings,
    netWorth: snapshot.netWorth,
    netWorthComplete: snapshot.netWorthComplete,
    badgesEarned: snapshot.badgesEarned,
    badgeCatalogSize: snapshot.badgesEarned === undefined
      ? undefined
      : invariants.achievementIds.length,
    endorsements: snapshot.endorsements,
    fleetTier: snapshot.fleetTier,
    meaningfulPlayedAt: snapshot.meaningfulPlayedAt,
    capturedAt: snapshot.capturedAt,
  };
}

export function recentEarnedAchievements(
  rows: Array<Doc<"freightFateAchievements">>,
  limit: number,
) {
  return rows
    .filter((row) => row.earnedAt !== undefined
      && row.name !== undefined && row.description !== undefined)
    .sort((a, b) => b.earnedAt! - a.earnedAt!
      || b.achievementKey.localeCompare(a.achievementKey))
    .slice(0, limit);
}
