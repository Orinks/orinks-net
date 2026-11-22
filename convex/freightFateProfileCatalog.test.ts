import { describe, expect, test } from "vitest";
import invariants from "../data/freight-fate-profile-invariants.json";
import careerTwo from "../data/freight-fate-profile-invariants-career-2.json";
import {
  FREIGHT_FATE_ACHIEVEMENT_CATEGORIES,
  FREIGHT_FATE_ACHIEVEMENT_DETAILS,
  FREIGHT_FATE_ACHIEVEMENT_LABELS,
  freightFateAchievementDetail,
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
      .toBe("Truck Driving Man");
    expect(FREIGHT_FATE_ACHIEVEMENT_DETAILS.first_delivery.category).toBe("road");
    expect(FREIGHT_FATE_ACHIEVEMENT_DETAILS.first_delivery.description.length).toBeGreaterThan(40);
    expect(FREIGHT_FATE_ACHIEVEMENT_CATEGORIES[0]).toEqual({ key: "road", title: "Out on the Road" });
    expect(freightFateAchievementDetail("first_delivery")).toEqual({
      description: FREIGHT_FATE_ACHIEVEMENT_DETAILS.first_delivery.description,
      category: "Out on the Road",
    });
    // Every badge the page can name has a description, in a known group.
    for (const key of Object.keys(FREIGHT_FATE_ACHIEVEMENT_LABELS)) {
      expect(freightFateAchievementDetail(key)).toMatchObject({
        description: expect.stringMatching(/\S/), category: expect.stringMatching(/\S/),
      });
    }

    expect(FREIGHT_FATE_CAREER_TITLES).toBe(invariants.careerTitles);
    // Labels cover both career lines: every stable key keeps its stable name,
    // and a Career 2.0 key a 2.0 save can hold gets its name too.
    expect(FREIGHT_FATE_CARRIER_LABELS).toMatchObject(invariants.carrierLabels);
    expect(FREIGHT_FATE_TRAILER_CATALOG).toMatchObject(invariants.trailerCatalog);
    expect(FREIGHT_FATE_ACHIEVEMENT_LABELS).toMatchObject(invariants.achievementLabels);
    expect(FREIGHT_FATE_CARRIER_LABELS).toMatchObject(careerTwo.carrierLabels);
    expect(FREIGHT_FATE_TRAILER_CATALOG).toMatchObject(careerTwo.trailerCatalog);
  });

  test("names the Career 2.0 regional and local carriers", () => {
    expect(FREIGHT_FATE_CARRIER_LABELS.chatanika_freight).toBe("Chatanika Freight Lines");
    expect(FREIGHT_FATE_CARRIER_LABELS.knik_arm_cartage).toBe("Knik Arm Cartage");
    expect(FREIGHT_FATE_TRAILER_PRICES.livestock).toBe(careerTwo.trailerCatalog.livestock.purchasePrice);
  });

  test("does not invent values for unknown catalog keys", () => {
    expect(FREIGHT_FATE_CARRIER_LABELS.unknown_carrier).toBeUndefined();
    expect(FREIGHT_FATE_TRAILER_CATALOG.unknown_trailer).toBeUndefined();
    expect(FREIGHT_FATE_TRAILER_PRICES.unknown_trailer).toBeUndefined();
    expect(FREIGHT_FATE_ACHIEVEMENT_LABELS.unknown_badge).toBeUndefined();
    expect(freightFateAchievementDetail("unknown_badge")).toEqual({});
  });
});
