import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const { getBoard } = vi.hoisted(() => ({ getBoard: vi.fn() }));
vi.mock("@/lib/freight-fate-online", () => ({
  getFreightFatePresenceBoardSnapshot: getBoard,
}));

import { FreightFateDriversBoard } from "./FreightFateDriversBoard";

const NOW = 1_800_000_000_000;

function board(drivers: Record<string, unknown>[] = []) {
  return { asOf: NOW, drivers };
}

function driver(overrides: Record<string, unknown> = {}) {
  return {
    driverId: "road-star-1234",
    displayName: "Road Star",
    activity: "Driving",
    detail: "Chicago to Denver",
    changedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("renders the drivers list without the sharing disclaimer", async () => {
  getBoard.mockResolvedValue(board([driver()]));

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  expect(html).toContain("Drivers on duty");
  expect(html).toContain("Road Star");
  expect(html).toContain("Chicago to Denver");
  expect(html).not.toContain("Players appear here while hauling a load");
  expect(html).not.toContain("never anything about the real player");
});

test("says the list is a still frame that will not refresh itself", async () => {
  getBoard.mockResolvedValue(board());

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // Before the browser takes over -- and forever, for a reader without
  // JavaScript -- the list really is a still frame. They have no page-load cue
  // either way, so the stamp has to say so and offer them something to do.
  expect(html).toContain("Refresh the page to check again");
  // ...and nothing may claim it keeps itself current, because at this point
  // it does not.
  expect(html).not.toContain("updates itself");
  expect(html).not.toContain("Pause the drivers list");
});

test("keeps the heading and explains itself when the list is unreachable", async () => {
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
  getBoard.mockResolvedValue(board());

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  expect(html).toContain("No drivers are on duty right now");
  expect(html).not.toContain("Check back in a few minutes");
});

test("the section is a named landmark, and the list says what it lists", async () => {
  getBoard.mockResolvedValue(board([driver()]));

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // A bare <section> is not a landmark at all, so the one block on this page
  // whose contents move on their own was the only one you could not jump back
  // to.
  expect(html).toContain('aria-labelledby="drivers-on-duty-heading"');
  expect(html).toContain('id="drivers-on-duty-heading"');
  expect(html).toContain('aria-label="Drivers on duty"');
});

test("a driver link says where it goes, keeping the visible name in the label", async () => {
  getBoard.mockResolvedValue(board([driver()]));

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // Heard in a list of links, a bare player name gives no clue it leads
  // anywhere. Visible text stays a leading substring so speech input still
  // works on what is on screen.
  expect(html).toContain('aria-label="Road Star, driver profile"');
});

test("drivers who would be spoken alike are told apart, and nobody else is", async () => {
  getBoard.mockResolvedValue(
    board([
      driver({ driverId: "driver-ab12", displayName: "Driver ab12" }),
      driver({ driverId: "masked-ab12", displayName: "Driver ab12" }),
      driver({ driverId: "road-star-1234", displayName: "Road Star" }),
    ]),
  );

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // Stored names are unique, but a moderated name is rendered from the
  // driver's own id and never goes through that rule -- so two masked drivers
  // can end up sounding identical.
  expect(html).toContain('aria-label="Driver ab12, driver profile ab12"');
  expect(html).toContain('aria-label="Driver ab12, driver profile ab12"');
  // The driver whose name is already unmistakable carries no extra characters.
  expect(html).toContain('aria-label="Road Star, driver profile"');
});

test("the list is alphabetical, not most-recent-first", async () => {
  getBoard.mockResolvedValue(
    board([
      driver({ driverId: "zeta-9999", displayName: "Zeta Hauler", changedAt: NOW }),
      driver({ driverId: "alpha-1111", displayName: "Alpha Hauler", changedAt: NOW - 600_000 }),
    ]),
  );

  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  // Sorted by recency the list reshuffles under anyone working down it. By
  // name, a driver reporting progress rewrites one line and moves nothing.
  expect(html.indexOf("Alpha Hauler")).toBeLessThan(html.indexOf("Zeta Hauler"));
});

test("a row with no stamp loses its age, not the whole section", async () => {
  getBoard.mockResolvedValue(board([driver({ changedAt: undefined })]));

  // The age is the one part of a row built by arithmetic, and the formatter
  // throws on anything not finite. A public endpoint is not worth trusting
  // with the section.
  const html = renderToStaticMarkup(await FreightFateDriversBoard());
  expect(html).toContain("Road Star");
  expect(html).toContain("Chicago to Denver");
  expect(html).not.toContain("Updated");
});
