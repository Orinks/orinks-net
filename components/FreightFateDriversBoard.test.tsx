import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const { getBoard } = vi.hoisted(() => ({ getBoard: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFatePresenceBoard: getBoard,
  normalizeFreightFateDisplayName: (value: string) => value,
}));

import { FreightFateDriversBoard } from "./FreightFateDriversBoard";

test("renders the drivers board without the sharing disclaimer", async () => {
  getBoard.mockResolvedValue({
    asOf: 1_800_000_000_000,
    drivers: [{
      driverId: "road-star-1234",
      displayName: "Road Star",
      activity: "Driving",
      detail: "Chicago to Denver",
      updatedAt: 1_800_000_000_000,
    }],
  });

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  expect(html).toContain("Drivers on duty");
  expect(html).toContain("Road Star");
  expect(html).toContain("Chicago to Denver");
  expect(html).not.toContain("Players appear here while hauling a load");
  expect(html).not.toContain("never anything about the real player");
});
