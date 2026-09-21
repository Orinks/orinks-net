import { describe, expect, test } from "vitest";
import { lastOnDutyPhrase } from "./freight-fate-presence";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("lastOnDutyPhrase", () => {
  const asOf = 1_800_000_000_000;

  test("a driver no session has ended for is not guessed at", () => {
    expect(lastOnDutyPhrase(undefined, asOf)).toBe("Not seen on duty yet.");
    expect(lastOnDutyPhrase(Number.NaN, asOf)).toBe("Not seen on duty yet.");
  });

  test("ages are coarse: hours, then days, then weeks, then months", () => {
    expect(lastOnDutyPhrase(asOf - 20 * 60_000, asOf)).toBe("Last on duty less than an hour ago.");
    expect(lastOnDutyPhrase(asOf - 1 * HOUR - 1, asOf)).toBe("Last on duty 1 hour ago.");
    expect(lastOnDutyPhrase(asOf - 30 * HOUR, asOf)).toBe("Last on duty 30 hours ago.");
    expect(lastOnDutyPhrase(asOf - 2 * DAY, asOf)).toBe("Last on duty 2 days ago.");
    expect(lastOnDutyPhrase(asOf - 13 * DAY, asOf)).toBe("Last on duty 13 days ago.");
    expect(lastOnDutyPhrase(asOf - 14 * DAY, asOf)).toBe("Last on duty 2 weeks ago.");
    expect(lastOnDutyPhrase(asOf - 61 * DAY, asOf)).toBe("Last on duty 2 months ago.");
  });

  test("a stamp from the future reads as just now rather than a negative age", () => {
    expect(lastOnDutyPhrase(asOf + HOUR, asOf)).toBe("Last on duty less than an hour ago.");
  });
});
