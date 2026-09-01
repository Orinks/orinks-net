import { describe, expect, test } from "vitest";
import invariants from "../data/freight-fate-profile-invariants.json";
import {
  FREIGHT_FATE_ACHIEVEMENT_LABELS,
  FREIGHT_FATE_CAREER_TITLES,
  FREIGHT_FATE_CARRIER_LABELS,
  FREIGHT_FATE_TRAILER_CATALOG,
  FREIGHT_FATE_TRAILER_PRICES,
} from "./freightFateProfileCatalog";

describe("Freight Fate public profile catalogs", () => {
  test("reads known public labels and prices from the generated artifact", () => {
    expect(FREIGHT_FATE_CAREER_TITLES[0]).toBe("Yard Trainee");
    expect(FREIGHT_FATE_CARRIER_LABELS.northstar).toBe("Northstar Freight Lines");
    expect(FREIGHT_FATE_TRAILER_CATALOG.dry_van).toEqual({
      label: "Dry van",
      purchasePrice: 42_000,
    });
    expect(FREIGHT_FATE_TRAILER_PRICES.dry_van).toBe(42_000);
    expect(FREIGHT_FATE_ACHIEVEMENT_LABELS.first_delivery)
      .toBe("Signed, Sealed, Hauled");

    expect(FREIGHT_FATE_CAREER_TITLES).toBe(invariants.careerTitles);
    expect(FREIGHT_FATE_CARRIER_LABELS).toBe(invariants.carrierLabels);
    expect(FREIGHT_FATE_TRAILER_CATALOG).toBe(invariants.trailerCatalog);
    expect(FREIGHT_FATE_ACHIEVEMENT_LABELS).toBe(invariants.achievementLabels);
  });

  test("does not invent values for unknown catalog keys", () => {
    expect(FREIGHT_FATE_CARRIER_LABELS.unknown_carrier).toBeUndefined();
    expect(FREIGHT_FATE_TRAILER_CATALOG.unknown_trailer).toBeUndefined();
    expect(FREIGHT_FATE_TRAILER_PRICES.unknown_trailer).toBeUndefined();
    expect(FREIGHT_FATE_ACHIEVEMENT_LABELS.unknown_badge).toBeUndefined();
  });
});
