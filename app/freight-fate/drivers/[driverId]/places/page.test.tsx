import { expect, test, vi } from "vitest";

const { safeProfile } = vi.hoisted(() => ({ safeProfile: vi.fn() }));
vi.mock("../profile-view", () => ({
  safeProfile,
  DriverProfileView: vi.fn(),
}));

import { generateMetadata } from "./page";

test("names the driver in the places title", async () => {
  safeProfile.mockResolvedValue({ driver: { displayName: "Road Star" } });
  await expect(generateMetadata({ params: Promise.resolve({ driverId: "road-star-1234" }) }))
    .resolves.toEqual({ title: "Places visited by Road Star" });
});

test("uses the generic unavailable title without leaking an identifier", async () => {
  safeProfile.mockResolvedValue(null);
  await expect(generateMetadata({ params: Promise.resolve({ driverId: "private-driver-secret" }) }))
    .resolves.toEqual({ title: "Freight Fate Profile Unavailable" });
});
