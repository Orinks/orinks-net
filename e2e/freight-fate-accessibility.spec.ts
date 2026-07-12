import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of [
  "/freight-fate",
  "/freight-fate/updates",
  "/freight-fate/drivers/missing-driver-1234",
]) {
  test(`${path} has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    // axe-core's broad Playwright peer range can resolve a newer type-only
    // playwright-core beside the version used by this app's test runner.
    const results = await new AxeBuilder({ page: page as never })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("updates and unavailable routes use ordinary SSR semantics without chatter", async ({ page }) => {
  await page.goto("/freight-fate/updates");
  await expect(page).toHaveTitle(/Freight Fate Updates/);
  await expect(page.getByRole("heading", { level: 1, name: "Freight Fate Updates" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Freight Fate updates" })).toBeVisible();
  await expect(page.locator("main [aria-live], main [role=status], main [role=feed]")).toHaveCount(0);

  await page.goto("/freight-fate/drivers/missing-driver-1234");
  await expect(page).toHaveTitle(/Freight Fate Profile Unavailable/);
  await expect(page.getByRole("heading", { level: 1, name: "Freight Fate Profile Unavailable" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("missing-driver-1234");
});

test("private-like and malformed profile URLs have identical non-leaking output", async ({ page }) => {
  await page.goto("/freight-fate/drivers/private-driver-1234");
  const first = await page.locator("main").innerText();
  const firstTitle = await page.title();
  await page.goto("/freight-fate/drivers/%25-invalid");
  expect(await page.locator("main").innerText()).toBe(first);
  expect(await page.title()).toBe(firstTitle);
});

test("keyboard skip navigation and route links remain usable", async ({ page }) => {
  await page.goto("/freight-fate/updates");
  await page.keyboard.press("Tab");
  const focusedName = await page.locator(":focus").textContent();
  expect(focusedName).toMatch(/Skip to (main content|content)/);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("compact updates disclosure is closed by default and uses native keyboard behavior", async ({ page }) => {
  await page.goto("/freight-fate");
  const details = page.locator("details").filter({ hasText: "Public Freight Fate updates" });
  const summary = details.locator("summary");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.getByRole("link", { name: "View all public Freight Fate updates" })).not.toBeVisible();
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(details.getByRole("link", { name: "View all public Freight Fate updates" })).toBeFocused();
  await summary.focus();
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("populated update links focus safe deep targets and preserve history", async ({ page }) => {
  await page.goto("/freight-fate/e2e-fixture");
  const first = page.getByRole("link", { name: "Delivered steel from Chicago to Denver." });
  const second = page.getByRole("link", { name: "Delivered produce from Omaha to Chicago." });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(await first.getAttribute("href")).toMatch(/#event-[A-Za-z0-9_-]+$/);
  await first.press("Enter");
  await expect(page).toHaveURL(/view=journal#event-/);
  await expect(page.locator("h3:focus")).toHaveText("Delivered steel from Chicago to Denver.");
  await page.goBack();
  await expect(page).toHaveURL(/e2e-fixture$/);
  await expect(page.locator("main")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/view=journal#event-/);
});

test("cursor pagination uses native route links in both directions", async ({ page }) => {
  await page.goto("/freight-fate/e2e-fixture?view=journal");
  const older = page.getByRole("link", { name: "Older road-journal entries" });
  await older.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/before=older/);
  await expect(page.locator("body")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "E2E Driver" })).toBeVisible();
  const newest = page.getByRole("link", { name: "Back to newest road-journal entries" });
  await newest.focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/before=older/);
  await expect(page.locator("body")).toBeFocused();
});

test("updates reflow at a narrow viewport and forced colors preserve controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/freight-fate/updates");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeVisible();
});

test("updates and profile routes remain available without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3108/freight-fate/updates");
  await expect(page.getByRole("heading", { level: 1, name: "Freight Fate Updates" })).toBeVisible();
  await page.goto("http://127.0.0.1:3108/freight-fate/drivers/missing-driver-1234");
  await expect(page.getByRole("heading", { level: 1, name: "Freight Fate Profile Unavailable" })).toBeVisible();
  await page.goto("http://127.0.0.1:3108/freight-fate/e2e-fixture");
  await page.getByRole("link", { name: "Delivered steel from Chicago to Denver." }).click();
  await expect(page).toHaveURL(/view=journal#event-/);
  await expect(page.getByRole("heading", { level: 3, name: "Delivered steel from Chicago to Denver." })).toBeVisible();
  const olderHref = await page.getByRole("link", { name: "Older road-journal entries" }).getAttribute("href");
  expect(olderHref).toContain("before=older");
  await page.goto(`http://127.0.0.1:3108${olderHref}`);
  await expect(page).toHaveURL(/before=older/);
  await context.close();
});
