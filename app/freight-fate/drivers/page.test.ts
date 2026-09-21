import { expect, test } from "vitest";
import * as page from "./page";

// The on-duty count is only as fresh as the page. As an ISR page the whole
// HTML was served stale-while-revalidating, and the first reader after a quiet
// spell heard a count up to hours old (live site, 2026-09-21). The data cache
// under it already bounds staleness; the page must not add a second one.
test("the directory page renders per request, not from a cached page", () => {
  expect(page.dynamic).toBe("force-dynamic");
  expect("revalidate" in page).toBe(false);
});
