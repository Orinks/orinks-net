import { describe, expect, test } from "vitest";
import { SingleFlightLatch } from "./singleFlightLatch";

describe("SingleFlightLatch", () => {
  test("ignores repeat activation until the transition settles", () => {
    const latch = new SingleFlightLatch();
    expect(latch.tryStart()).toBe(true);
    expect(latch.tryStart()).toBe(false);
  });

  test("allows retry after a failed transition releases the latch", () => {
    const latch = new SingleFlightLatch();
    expect(latch.tryStart()).toBe(true);
    latch.release();
    expect(latch.tryStart()).toBe(true);
  });
});
