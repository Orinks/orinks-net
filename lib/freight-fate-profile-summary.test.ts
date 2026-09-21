import { expect, test } from "vitest";
import { freightFateProfileSummary } from "./freight-fate-profile-summary";

const driver = { driverId: "road-star-1234", displayName: "Road Star", visibility: "public", createdAt: 1, updatedAt: 2 };

test("a hidden profile stays hidden", () => {
  expect(freightFateProfileSummary(null)).toBeNull();
  expect(freightFateProfileSummary(undefined)).toBeNull();
});

test("only the spoken sections come through, and only three journal lines", () => {
  const summary = freightFateProfileSummary({
    driver,
    snapshot: { level: 4 },
    presence: { activity: "Driving", detail: "", updatedAt: 5 },
    achievementCount: 7,
    recentAchievements: [{ achievementKey: "first_delivery", label: "First Delivery", earnedAt: 3 }],
    events: [1, 2, 3, 4, 5].map((n) => ({ eventId: `e${n}`, summary: `line ${n}` })),
    // The page sections the game never reads.
    achievements: [{ achievementKey: "x" }],
    nextBefore: { occurredAt: 1, eventId: "e5" },
    nextAchievementBefore: { sortAt: 1, achievementKey: "x" },
  } as never);

  expect(summary).toEqual({
    driver,
    snapshot: { level: 4 },
    presence: { activity: "Driving", detail: "", updatedAt: 5 },
    achievementCount: 7,
    recentAchievements: [{ achievementKey: "first_delivery", label: "First Delivery", earnedAt: 3 }],
    events: [
      { eventId: "e1", summary: "line 1" },
      { eventId: "e2", summary: "line 2" },
      { eventId: "e3", summary: "line 3" },
    ],
  });
  expect(summary).not.toHaveProperty("achievements");
  expect(summary).not.toHaveProperty("nextBefore");
});

test("a profile with no career, no presence and nothing earned reads as empty, not broken", () => {
  expect(freightFateProfileSummary({
    driver, snapshot: null, presence: null, achievementCount: 0, recentAchievements: [], events: [],
  })).toEqual({ driver, snapshot: null, presence: null, achievementCount: 0, recentAchievements: [], events: [] });
});
