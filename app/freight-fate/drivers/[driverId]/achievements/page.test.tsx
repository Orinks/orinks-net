import { expect, test, vi } from "vitest";

const { safeProfile } = vi.hoisted(() => ({ safeProfile: vi.fn() }));
vi.mock("../profile-view", () => ({
  safeProfile,
  parseAchievementCursor: vi.fn(),
  DriverProfileView: vi.fn(),
}));

import { generateMetadata } from "./page";

test("uses an account-wide achievement title for a visible driver", async () => {
  safeProfile.mockResolvedValue({ driver: { displayName: "Road Star" } });
  await expect(generateMetadata({ params: Promise.resolve({ driverId: "road-star-1234" }) }))
    .resolves.toEqual({ title: "Account-wide achievements for Road Star" });
});

test("uses the generic unavailable title without leaking an identifier", async () => {
  safeProfile.mockResolvedValue(null);
  await expect(generateMetadata({ params: Promise.resolve({ driverId: "private-driver-secret" }) }))
    .resolves.toEqual({ title: "Freight Fate Profile Unavailable" });
});
