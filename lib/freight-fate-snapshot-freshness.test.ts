import { describe, expect, test, vi } from "vitest";

import { FREIGHT_FATE_SNAPSHOT_MAX_AGE_MS, freshSnapshot } from "./freight-fate-online";

// A cached snapshot is handed to the first reader after a quiet spell as it
// stands and rebuilt only in the background, so the guard is what stops a
// day-old driver directory reaching a player.
describe("freshSnapshot", () => {
  const now = 1_000_000_000;

  test("a recent snapshot is served as cached, with no live read", async () => {
    const cached = vi.fn().mockResolvedValue({ asOf: now - 30_000, drivers: ["cached"] });
    const live = vi.fn();

    await expect(freshSnapshot(cached, live, now)).resolves.toEqual({ asOf: now - 30_000, drivers: ["cached"] });
    expect(live).not.toHaveBeenCalled();
  });

  test("a snapshot older than the ceiling is replaced by a live read", async () => {
    const cached = vi.fn().mockResolvedValue({ asOf: now - FREIGHT_FATE_SNAPSHOT_MAX_AGE_MS - 1, drivers: ["stale"] });
    const live = vi.fn().mockResolvedValue({ asOf: now, drivers: ["live"] });

    await expect(freshSnapshot(cached, live, now)).resolves.toEqual({ asOf: now, drivers: ["live"] });
    expect(cached).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
  });

  test("exactly at the ceiling still counts as recent", async () => {
    const cached = vi.fn().mockResolvedValue({ asOf: now - FREIGHT_FATE_SNAPSHOT_MAX_AGE_MS, drivers: ["cached"] });
    const live = vi.fn();

    await expect(freshSnapshot(cached, live, now)).resolves.toEqual({ asOf: now - FREIGHT_FATE_SNAPSHOT_MAX_AGE_MS, drivers: ["cached"] });
    expect(live).not.toHaveBeenCalled();
  });

  test("no backend stays a null answer", async () => {
    const cached = vi.fn().mockResolvedValue(null);
    const live = vi.fn();

    await expect(freshSnapshot(cached, live, now)).resolves.toBeNull();
    expect(live).not.toHaveBeenCalled();
  });
});
