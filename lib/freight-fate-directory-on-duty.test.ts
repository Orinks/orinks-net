import { describe, expect, test } from "vitest";

import { onDutyFromBoard } from "./freight-fate-online";

// The directory and the drivers list were two snapshots cached on their own
// clocks, so for a few minutes after anyone came on or went off duty the two
// could name different drivers: five on duty on the list, four in the
// directory (reported 2026-09-26). The directory now takes who is on duty
// from the list's own snapshot, so the two cannot disagree.
describe("onDutyFromBoard", () => {
  const asOf = 1_000_000_000;
  const board = {
    asOf: asOf + 30_000,
    drivers: [
      { driverId: "arrived-1", displayName: "Just Arrived", activity: "Driving", detail: "reefer", changedAt: asOf + 20_000 },
      { driverId: "steady-1", displayName: "Steady Hauler", activity: "Driving", detail: "40% there", changedAt: asOf + 10_000 },
      { driverId: "brand-new-1", displayName: "Brand New", activity: "Driving", detail: "steel", changedAt: asOf + 25_000 },
    ],
  };
  const directory = {
    asOf,
    drivers: [
      { driverId: "steady-1", displayName: "Steady Hauler", onDuty: true, activity: "Driving", detail: "35% there", changedAt: asOf },
      { driverId: "gone-1", displayName: "Gone Home", onDuty: true, activity: "Driving", detail: "reefer", changedAt: asOf, lastOnDutyAt: asOf - 60_000 },
      { driverId: "arrived-1", displayName: "Just Arrived", onDuty: false, lastOnDutyAt: asOf - 3_600_000 },
      { driverId: "never-1", displayName: "Never Seen", onDuty: false },
    ],
  };

  test("on duty in the directory is exactly who the drivers list has on duty", () => {
    const merged = onDutyFromBoard(directory, board);

    expect(merged.drivers.filter((row) => row.onDuty).map((row) => row.driverId).sort())
      .toEqual(board.drivers.map((row) => row.driverId).sort());
  });

  test("on duty first, with the list's own status; everyone else keeps the directory's order", () => {
    const merged = onDutyFromBoard(directory, board);

    expect(merged.asOf).toBe(asOf);
    expect(merged.drivers.map((row) => [row.driverId, row.onDuty])).toEqual([
      ["steady-1", true], ["arrived-1", true], ["brand-new-1", true],
      ["gone-1", false], ["never-1", false],
    ]);
    expect(merged.drivers[0]).toMatchObject({ detail: "40% there", changedAt: asOf + 10_000 });
    // Arriving keeps the stamp from the last session; leaving drops what the
    // driver was doing but not when they were last seen.
    expect(merged.drivers[1]).toMatchObject({ activity: "Driving", lastOnDutyAt: asOf - 3_600_000 });
    expect(merged.drivers[2]).toEqual({
      driverId: "brand-new-1", displayName: "Brand New", onDuty: true,
      activity: "Driving", detail: "steel", changedAt: asOf + 25_000,
    });
    expect(merged.drivers[3]).toEqual({
      driverId: "gone-1", displayName: "Gone Home", onDuty: false, lastOnDutyAt: asOf - 60_000,
    });
  });

  test("nobody on the list means nobody on duty in the directory", () => {
    const merged = onDutyFromBoard(directory, { asOf, drivers: [] });

    expect(merged.drivers.some((row) => row.onDuty)).toBe(false);
    expect(merged.drivers).toHaveLength(directory.drivers.length);
  });
});
