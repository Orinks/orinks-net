import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of [
  "/freight-fate",
  "/freight-fate/updates",
  "/freight-fate/drivers/missing-driver-1234",
  "/freight-fate/news",
  "/freight-fate/news/24",
  "/freight-fate/news/archive",
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

test("landing page leads with one heading, the 1.9 download, and overview headings", async ({ page }) => {
  await page.goto("/freight-fate");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Freight Fate" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("orinks.net");
  const download = page.getByRole("link", { name: "Downloads", exact: true });
  await expect(download).toHaveCount(1);
  await expect(download).toHaveAttribute("href", "/freight-fate/downloads");
  for (const name of ["Driving and freight", "Career and radio", "Community and source"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.locator("main h3")).toHaveCount(0);
  // The live sections come before the pitch, so a returning player reaches them first.
  const h2s = await page.locator("main h2").allTextContents();
  expect(h2s.indexOf("Driver updates")).toBeGreaterThan(-1);
  expect(h2s.indexOf("Driver updates")).toBeLessThan(h2s.indexOf("Driving and freight"));
  expect(h2s.at(-1)).toBe("Community and source");
});

test("compact updates disclosure is closed by default and uses native keyboard behavior", async ({ page }) => {
  await page.goto("/freight-fate");
  const heading = page.getByRole("heading", { level: 2, name: "Driver updates" });
  await expect(heading).toBeVisible();
  const details = page.locator("details").filter({ hasText: "Show recent updates" });
  const summary = details.locator("summary");
  await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveJSProperty("tagName", "DETAILS");
  await expect(summary).toHaveText("Show recent updates");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.getByRole("link", { name: "View all Freight Fate updates" })).not.toBeVisible();
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(details.getByRole("link", { name: "View all Freight Fate updates" })).toBeFocused();
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
  await older.press("Enter");
  await expect(page).toHaveURL(/before=older/);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Driver" })).toBeFocused();
  const newest = page.getByRole("link", { name: "Back to newest road-journal entries" });
  await newest.focus();
  await newest.press("Enter");
  await expect(page).not.toHaveURL(/before=older/);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Driver" })).toBeFocused();
});

test("shared route focus supports custom page headings", async ({ page }) => {
  await page.goto("/midnight-signal");
  const leaderboard = page.getByRole("link", { name: "Leaderboard" });
  await leaderboard.focus();
  await leaderboard.press("Enter");
  await expect(page).toHaveURL(/\/midnight-signal\/leaderboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeFocused();
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

test("global navigation, footer status, and game links remain unambiguous", async ({ page }) => {
  await page.goto("/games");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(1);
  await expect(page.locator("footer [aria-live], footer [role=status]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View Freight Fate details" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Downloads: Freight Fate" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Freight Fate: GitHub repository" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Saltwake: Report an issue" }),
  ).toBeVisible();
});

// The driver newspaper, read from the fixture edition (playwright.config.ts).
for (const path of ["/freight-fate/news", "/freight-fate/news/24"]) {
  test(`${path} reads as a document: one h1, no skipped heading level, named tables and links`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main article, main [aria-live], main [role=status]")).toHaveCount(0);

    const levels = await page.locator("main h1, main h2, main h3, main h4, main h5, main h6")
      .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    }

    const tables = page.locator("main table");
    expect(await tables.count()).toBeGreaterThan(0);
    for (const table of await tables.all()) {
      await expect(table.locator("caption")).toHaveCount(1);
      await expect(table.locator("caption")).not.toHaveText("");
      const rows = await table.locator("tbody tr").count();
      await expect(table.locator("tbody th[scope=row]")).toHaveCount(rows);
      await expect(table.locator("thead th:not([scope=col])")).toHaveCount(0);
    }

    for (const link of await page.locator("main a").all()) {
      await expect(link).toHaveAttribute("href", /.+/);
      expect((await link.innerText()).trim()).not.toBe("");
    }

    const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);

    await expect(page.getByRole("navigation", { name: "Earlier issues" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Back page: fiction" })).toBeVisible();
  });
}

test("the latest edition leads with Since Monday; a past one has none and links back", async ({ page }) => {
  await page.goto("/freight-fate/news");
  await expect(page.getByRole("heading", { level: 1, name: "The Mile Marker, issue 25" })).toBeVisible();
  const h2s = await page.locator("main h2").allTextContents();
  expect(h2s[0]).toMatch(/^Since Monday, /);
  // One link per driver per story: the headline links, the body does not.
  const story = page.locator("main h3").first();
  await expect(story.getByRole("link")).toHaveCount(1);
  await expect(story.locator("xpath=following-sibling::p[1]").getByRole("link")).toHaveCount(0);

  await page.goto("/freight-fate/news/24");
  expect((await page.locator("main h2").allTextContents()).some((text) => text.startsWith("Since Monday"))).toBe(false);
  await expect(page.getByRole("navigation", { name: "Earlier issues" }).getByRole("link", { name: "Latest issue" }))
    .toHaveAttribute("href", "/freight-fate/news");
});

test("the Road report prints after Freight, its headline-only stories with no paragraph", async ({ page }) => {
  await page.goto("/freight-fate/news");
  const h2s = await page.locator("main h2").allTextContents();
  expect(h2s.indexOf("Road report")).toBe(h2s.indexOf("Freight") + 1);
  const section = page.locator("main section").filter({ has: page.getByRole("heading", { level: 2, name: "Road report" }) });
  await expect(section.getByRole("heading", { level: 3, name: "Weather drivers met most: heavy rain" })).toBeVisible();
  await expect(section.getByRole("heading", { level: 3, name: "One load ran under a chain law" })).toBeVisible();
  await expect(section.getByRole("heading", { level: 3, name: "Drivers passed 14 open scales" })).toBeVisible();
  await expect(section.locator("p")).toHaveCount(1);
});

test("the standings table is a scrolling stop only while it overflows", async ({ page }) => {
  await page.goto("/freight-fate/news");
  await expect(page.locator("main [role=region]")).toHaveCount(0);
  await expect(page.locator("main [tabindex='0']")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("region", { name: /^Carriers/ })).toHaveAttribute("tabindex", "0");
  await expect(page.locator("main [role=region]")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("earlier issues page through with named titles", async ({ page }) => {
  await page.goto("/freight-fate/news");
  await page.getByRole("link", { name: "Older issues" }).click();
  await expect(page).toHaveURL(/archive\?before=5$/);
  await expect(page).toHaveTitle(/^The Mile Marker, issues 1 to 4/);
  await expect(page.getByRole("heading", { level: 1, name: "The Mile Marker, issues 1 to 4" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Older issues" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Newer issues" })).toBeVisible();
});

test("the paper's feed lists editions with their front-page headlines", async ({ request }) => {
  const response = await request.get("/freight-fate/news/feed.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await response.text();
  expect(xml).toContain("<title>The Mile Marker, issue 25</title>");
  expect(xml).not.toContain("{@");
});

test("an issue that does not exist answers 404", async ({ request }) => {
  expect((await request.get("/freight-fate/news/999")).status()).toBe(404);
  expect((await request.get("/freight-fate/news/012")).status()).toBe(404);
});
