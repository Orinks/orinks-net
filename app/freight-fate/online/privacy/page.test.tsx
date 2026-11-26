// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFatePrivacyPage from "./page";
import { ProfileSharing } from "./profile-sharing";

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
  // The paper is announced (lib/freight-fate-paper-launch.ts), so the page
  // says what it may print.
  expect(copy).toContain("The weekly driver newspaper on orinks.net can write about your career");
  for (const privateDetail of [
    "current cash", "available credit", "precise location",
    "the cargo and destination of a load you are still hauling",
    "customer", "cargo value", "fatigue", "exact hours-of-service state",
    "dispatcher standing",
  ]) expect(copy.toLowerCase()).toContain(privateDetail);
  expect(copy.toLowerCase()).not.toMatch(/this is (?:a )?(?:fiction|game)|fictional/);
});

function text(announced: boolean) {
  const parsed = document.implementation.createHTMLDocument();
  parsed.body.innerHTML = renderToStaticMarkup(<ProfileSharing announced={announced} />);
  return parsed.body.textContent ?? "";
}

test("before the paper is announced, Profile sharing keeps the wording from before it", () => {
  const copy = text(false);
  expect(copy).toContain("Turning Profile sharing off removes them from public pages.");
  expect(copy).toContain("precise location, exact cargo, customer, cargo value, destination, fatigue");
  expect(copy.toLowerCase()).not.toContain("newspaper");
});

test("once announced, it says what the paper may print and that sharing off takes it back", () => {
  const copy = text(true);
  expect(copy).toContain("including the cargo type and the cities of deliveries you finished");
  expect(copy).toContain("the newspaper's past issues included");
  for (const privateDetail of [
    "current cash", "available credit", "precise location",
    "the cargo and destination of a load you are still hauling",
    "customer", "cargo value", "fatigue", "exact hours-of-service state",
    "dispatcher standing",
  ]) expect(copy.toLowerCase()).toContain(privateDetail);
});
