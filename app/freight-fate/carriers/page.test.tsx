// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFateCarriersPage from "./page";
import FreightFateCarrierPage, { generateStaticParams } from "./[carrierKey]/page";

function documentFor(markup: string) {
  const parsed = document.implementation.createHTMLDocument();
  parsed.body.innerHTML = markup;
  return parsed;
}

test("the comparison table names every carrier with row and column headers", () => {
  const page = documentFor(renderToStaticMarkup(<FreightFateCarriersPage />));
  expect(Array.from(page.querySelectorAll("h1"), (node) => node.textContent)).toEqual(["Freight Fate Carriers"]);
  const table = page.querySelector("table")!;
  expect(table.querySelector("caption")?.textContent).toBe("Wage plan and dispatch for each carrier");
  expect(Array.from(table.querySelectorAll("thead th"), (node) => node.getAttribute("scope"))).toEqual(Array(6).fill("col"));
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  expect(rows.map((row) => row.querySelector("th[scope=row] a")?.getAttribute("href"))).toEqual([
    "/freight-fate/carriers/great_lakes_training",
    "/freight-fate/carriers/northstar",
    "/freight-fate/carriers/prairie_link",
    "/freight-fate/carriers/summit_value",
  ]);
  const northstar = rows[1].textContent!;
  expect(northstar).toContain("36 percent");
  expect(northstar).toContain("82 cents a mile");
  expect(northstar).toContain("175 dollars a load");
  expect(page.body.textContent).not.toMatch(/[$%]/);
});

test("every carrier page carries the shared benefits, anchored for profile links", () => {
  const page = documentFor(renderToStaticMarkup(<FreightFateCarriersPage />));
  const equipment = page.getElementById("equipment")!;
  expect(equipment.tagName).toBe("H2");
  expect(equipment.getAttribute("tabindex")).toBe("-1");
  expect(page.body.textContent).toContain("Level 9 and up: long-haul fleet");
  expect(page.body.textContent).toContain("From level 18 you can buy in as an owner-operator");
  expect(page.body.textContent).toContain("leased on to Northstar Freight Lines");
  expect(page.body.textContent).toContain("Level 2: flatbed securement and refrigerated certificates");
  expect(page.querySelector("section[aria-labelledby]")).toBeNull();
});

test("a carrier page states its own wage plan and dispatch", async () => {
  expect(generateStaticParams()).toHaveLength(4);
  const page = documentFor(renderToStaticMarkup(await FreightFateCarrierPage({ params: Promise.resolve({ carrierKey: "prairie_link" }) })));
  expect(Array.from(page.querySelectorAll("h1"), (node) => node.textContent)).toEqual(["Prairie Link Regional"]);
  const facts = Array.from(page.querySelectorAll("dl > div"), (row) => row.textContent);
  expect(facts).toEqual([
    "Pay share34 percent of what each load pays",
    "Per-mile floor95 cents a mile",
    "Stop pay130 dollars a load",
    "On-time bonus3 percent of what the load pays",
  ]);
  expect(page.body.textContent).toContain("The freight board favors grain, farm inputs, and bulk materials.");
  expect(page.body.textContent).toContain("starts on Kansas City");
});

test("an unknown carrier is not found", async () => {
  await expect(FreightFateCarrierPage({ params: Promise.resolve({ carrierKey: "nobody" }) })).rejects.toThrow();
});
