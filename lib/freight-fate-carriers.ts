import invariants from "../data/freight-fate-profile-invariants.json";

// Every figure on the carrier pages comes from the game's own export, so a
// balance pass that moves a wage plan moves these pages with it.

export type FreightFateCarrierPay = {
  payShare: number;
  minPerMile: number;
  stopPay: number;
  onTimeBonusShare: number;
};

export type FreightFateCarrier = {
  key: string;
  name: string;
  suggestedHomeTerminal: string;
  description: string;
  pay: FreightFateCarrierPay;
  dispatch: string;
  favoredFreight: string[];
};

type TrainingRow = { label: string; level?: number; tier: string };

const CARRIER_ROWS = invariants.carriers as Record<string, Omit<FreightFateCarrier, "key">>;

export const FREIGHT_FATE_CARRIERS: readonly FreightFateCarrier[] = Object.entries(CARRIER_ROWS)
  .map(([key, carrier]) => ({ key, ...carrier }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const FREIGHT_FATE_COMPANY_PAY = invariants.companyPay;
export const FREIGHT_FATE_FLEET_TIERS: readonly { minLevel: number; label: string }[] = invariants.fleetTiers;
// The level where a company driver can buy in as an owner-operator; the
// game keeps its title fork and the buy-in level in lockstep.
export const FREIGHT_FATE_BUY_IN_LEVEL: number = invariants.companyRankForkLevel;

const TRAINING_ROWS = Object.values(invariants.endorsements as Record<string, TrainingRow>);

/** Carrier-sponsored training, grouped by the level (and credential kind) it comes at. */
export const FREIGHT_FATE_SPONSORED_TRAINING: readonly { level: number; tier: string; labels: string[] }[] = (() => {
  const groups = new Map<string, { level: number; tier: string; labels: string[] }>();
  for (const row of TRAINING_ROWS) {
    if (row.level === undefined) continue;
    const id = `${row.level}:${row.tier}`;
    const group = groups.get(id) ?? { level: row.level, tier: row.tier, labels: [] };
    group.labels.push(row.label);
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.level - b.level || a.tier.localeCompare(b.tier))
    .map((group) => ({ ...group, labels: group.labels.sort() }));
})();

/** Credentials no carrier sponsors by level: only their own course earns them. */
export const FREIGHT_FATE_COURSE_ONLY_TRAINING: readonly string[] = TRAINING_ROWS
  .filter((row) => row.level === undefined)
  .map((row) => row.label)
  .sort((a, b) => a.localeCompare(b));

/** Carriers an owner-operator start is leased on to (start options with no wage plan). */
export const FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS: readonly string[] = [
  ...new Set(Object.entries(invariants.carrierLabels as Record<string, string>)
    .filter(([key]) => !(key in CARRIER_ROWS))
    .map(([, name]) => name)),
];

export function freightFateCarrier(key: string) {
  return FREIGHT_FATE_CARRIERS.find((carrier) => carrier.key === key);
}

export function freightFateCarrierHref(key: string) {
  return `/freight-fate/carriers/${key}`;
}

/** The carrier page a public profile's carrier name links to. */
export function freightFateCarrierHrefForName(name: string) {
  const carrier = FREIGHT_FATE_CARRIERS.find((row) => row.name === name);
  return carrier ? freightFateCarrierHref(carrier.key) : undefined;
}

export function sharePercent(share: number) {
  return `${Math.round(share * 100)} percent`;
}

export function perMile(value: number) {
  return value < 1 ? `${Math.round(value * 100)} cents a mile` : `${value.toFixed(2)} dollars a mile`;
}

export function wholeDollars(value: number) {
  return `${value.toLocaleString("en-US")} dollars`;
}

export function listInWords(items: readonly string[]) {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} and ${items.at(-1)}`;
}

export function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
