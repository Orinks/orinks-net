// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFatePrivacyPage from "./page";

test("explains profile selection, private cloud retention, and operational privacy independently", () => {
  const parsed = document.implementation.createHTMLDocument();
  parsed.body.innerHTML = renderToStaticMarkup(<FreightFatePrivacyPage />);
  expect(Array.from(parsed.querySelectorAll("h1"), (node) => node.textContent)).toEqual(["Freight Fate Online Features"]);
  const copy = parsed.body.textContent ?? "";
  expect(copy).toContain("current verified career and resume");
  expect(copy).toContain("account-wide achievements");
  expect(copy).toContain("Meaningful play selects your current career");
  expect(copy).toContain("Browsing, opening, or loading a career does not switch it");
  expect(copy).toContain("Cloud Backup remains private");
  expect(copy).toContain("up to ten careers");
  expect(copy).toContain("never deletes a career stored on your computer");
  expect(copy).toContain("Current cash, available credit, precise location, active cargo details, fatigue, hours-of-service state, and dispatcher standing remain private");
  expect(copy.toLowerCase()).not.toMatch(/this is (?:a )?(?:fiction|game)|fictional/);
});
