import type { Doc } from "./_generated/dataModel";
import invariants from "../data/freight-fate-profile-invariants.json";
import {
  FREIGHT_FATE_ACHIEVEMENT_LABELS,
  FREIGHT_FATE_ACHIEVEMENT_ID_SET,
  FREIGHT_FATE_CAREER_TITLES,
  FREIGHT_FATE_CARRIER_LABELS,
  FREIGHT_FATE_TRAILER_PRICES,
} from "./freightFateProfileCatalog";

type JsonObject = Record<string, unknown>;
export type AchievementCursor = { sortAt: number; achievementKey: string };

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
  let equipmentValue = ownedTrucks.reduce(
    (total, truck) => total + (truckPrices[truck] ?? 0),
    0,
  );
  equipmentValue += (payload.owned_trailers as string[]).reduce(
    (total, trailer) => total + (FREIGHT_FATE_TRAILER_PRICES[trailer] ?? 0),
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
  const knownCities = cities?.filter((city) => cityLabels[city] !== undefined);
  const states = knownCities
    ? new Set(knownCities.map((city) => cityLabels[city].split(", ").at(-1)))
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
    .filter(([key, def]) => (typeof def.level === "number" && level >= def.level)
      || purchased.includes(key))
    .sort(([, a], [, b]) => {
      const aLevel = a.level ?? Number.MAX_SAFE_INTEGER;
      const bLevel = b.level ?? Number.MAX_SAFE_INTEGER;
      return aLevel === bLevel ? a.label.localeCompare(b.label) : aLevel - bLevel;
    })
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
    ...(knownCities ? { citiesVisited: knownCities.length, statesVisited: states!.size } : {}),
    truckName: truckLabels[args.payload.truck as string],
    ...(businessStatus ? { truckIsCarrierAssigned: businessStatus === "company_driver" } : {}),
    employmentStatus,
    ...(safety ? { safetyRecord: safety } : {}),
    lifetimeEarnings: Math.round(career.total_earnings as number),
    ...netWorthProjection(args.payload, businessStatus),
    badgesEarned: (args.payload.achievements as unknown[])
      .filter((id) => typeof id === "string" && FREIGHT_FATE_ACHIEVEMENT_ID_SET.has(id)).length,
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
    safetyRecord: snapshot.safetyRecord ? {
      citations: snapshot.safetyRecord.citations,
      seriousViolations: snapshot.safetyRecord.seriousViolations,
      majorOffenses: snapshot.safetyRecord.majorOffenses,
      cargoClaims: snapshot.safetyRecord.cargoClaims,
      preventableEquipmentDamage: snapshot.safetyRecord.preventableEquipmentDamage,
      carrierTerminations: snapshot.safetyRecord.carrierTerminations,
      repossessions: snapshot.safetyRecord.repossessions,
    } : undefined,
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
      && FREIGHT_FATE_ACHIEVEMENT_LABELS[row.achievementKey] !== undefined)
    .sort((a, b) => b.earnedAt! - a.earnedAt!
      || b.achievementKey.localeCompare(a.achievementKey))
    .slice(0, limit)
    .map((row) => ({
      _id: row._id,
      achievementKey: row.achievementKey,
      label: FREIGHT_FATE_ACHIEVEMENT_LABELS[row.achievementKey],
      earnedAt: row.earnedAt!,
    }));
}

export function accountAchievementPage(
  rows: Array<Doc<"freightFateAchievements">>,
  limit: number,
  before?: AchievementCursor,
) {
  const ordered = rows
    .filter((row) => FREIGHT_FATE_ACHIEVEMENT_LABELS[row.achievementKey] !== undefined)
    .map((row) => ({
      _id: row._id,
      achievementKey: row.achievementKey,
      label: FREIGHT_FATE_ACHIEVEMENT_LABELS[row.achievementKey],
      ...(row.earnedAt === undefined ? {} : { earnedAt: row.earnedAt }),
      sortAt: row.earnedAt ?? -1,
    }))
    .sort((a, b) => b.sortAt - a.sortAt
      || b.achievementKey.localeCompare(a.achievementKey));
  const remaining = before
    ? ordered.filter((item) => item.sortAt < before.sortAt
      || (item.sortAt === before.sortAt
        && item.achievementKey.localeCompare(before.achievementKey) < 0))
    : ordered;
  const page = remaining.slice(0, limit);
  const last = page.at(-1);
  return {
    achievements: page.map(({ sortAt: _sortAt, ...item }) => item),
    nextAchievementBefore: remaining.length > limit && last
      ? { sortAt: last.sortAt, achievementKey: last.achievementKey }
      : null,
  };
}

export function publicDriverEvent(row: Doc<"freightFateDriverEvents">) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as JsonObject
    : undefined;
  let eventType: string;
  let summary: string;
  switch (row.eventType) {
    case "delivery_completed": {
      eventType = "delivery_completed";
      const miles = typeof payload?.distanceMiles === "number"
        && Number.isFinite(payload.distanceMiles) && payload.distanceMiles >= 0
        && payload.distanceMiles <= 10_000
        ? Math.round(payload.distanceMiles).toLocaleString("en-US")
        : undefined;
      summary = miles
        ? `Completed a delivery covering ${miles} miles${payload?.onTime === true ? " on time" : ""}.`
        : "Completed a delivery.";
      break;
    }
    case "delivery":
      eventType = "delivery_completed";
      summary = "Completed a delivery.";
      break;
    case "achievement_earned": {
      const key = typeof payload?.achievementKey === "string"
        ? payload.achievementKey
        : undefined;
      const label = key ? FREIGHT_FATE_ACHIEVEMENT_LABELS[key] : undefined;
      if (!label) return null;
      eventType = "achievement_earned";
      summary = `Earned ${label}.`;
      break;
    }
    case "career_milestone": {
      if (payload?.milestoneType === "first_delivery") {
        eventType = "career_milestone";
        summary = "Completed a first Freight Fate delivery.";
      } else if (payload?.milestoneType === "career_level"
        && Number.isInteger(payload.level) && (payload.level as number) >= 1) {
        eventType = "career_milestone";
        summary = `Reached driver level ${Math.min(payload.level as number, 999)}.`;
      } else return null;
      break;
    }
    case "job_accepted":
      eventType = "job_accepted";
      summary = "Accepted a job.";
      break;
    case "drive_started":
      eventType = "drive_started";
      summary = "Started driving.";
      break;
    case "equipment_changed":
      eventType = "equipment_changed";
      summary = "Changed equipment.";
      break;
    case "business_changed":
      eventType = "business_changed";
      summary = "Changed business status.";
      break;
    default:
      return null;
  }
  return {
    _id: row._id,
    eventId: row.eventId,
    eventType,
    summary,
    occurredAt: row.occurredAt,
  };
}
