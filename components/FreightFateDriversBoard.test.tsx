import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const { getBoard } = vi.hoisted(() => ({ getBoard: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFatePresenceBoardSnapshot: getBoard,
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

test("says the board is a snapshot that will not refresh itself", async () => {
  getBoard.mockResolvedValue({ asOf: 1_800_000_000_000, drivers: [] });

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // A reader has no page-load cue that the roster is a still frame, so the
  // stamp has to say so and offer them something to do.
  expect(html).toContain("Refresh the page to check again");
});

test("keeps the heading and explains itself when the board is unreachable", async () => {
  getBoard.mockRejectedValue(new Error("backend unreachable"));

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // The heading has to survive: readers navigate this page by heading, and a
  // section that vanishes on failure sends them hunting for it.
  expect(html).toContain("Drivers on duty");
  expect(html).toContain("We can&#x27;t show who&#x27;s on duty right now");
  expect(html).toContain("Check back in a few minutes");
});

test("omits the section entirely when online presence is not configured", async () => {
  getBoard.mockResolvedValue(null);

  const rendered = await FreightFateDriversBoard();
  expect(rendered).toBeNull();
});

test("an empty road never reads as a failure", async () => {
  getBoard.mockResolvedValue({ asOf: 1_800_000_000_000, drivers: [] });

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  expect(html).toContain("No drivers are on duty right now");
  expect(html).not.toContain("Check back in a few minutes");
});
