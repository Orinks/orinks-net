import { describe, expect, it } from "vitest";
import { addManualHeadingIds } from "./manual-headings";

describe("embedded manual heading links", () => {
  it("adds fragment targets without changing heading levels or attributes", () => {
    const markdown = "## Main menu\n### Once you've created a career\n#### Choose career";
    const html = '<h2 dir="auto">Main menu</h2><h3>Once you&#39;ve created a career</h3><h4>Choose career</h4><a href="#main-menu">Main menu</a>';
    expect(addManualHeadingIds(html, markdown)).toBe(
      '<h2 dir="auto" id="main-menu">Main menu</h2><h3 id="once-youve-created-a-career">Once you&#39;ve created a career</h3><h4 id="choose-career">Choose career</h4><a href="#main-menu">Main menu</a>',
    );
  });

  it("keeps repeated and already suffixed headings unique", () => {
    expect(addManualHeadingIds("<h2>Radio</h2><h2>Radio</h2><h3>Radio-1</h3>", "## Radio\n## Radio\n### Radio-1")).toBe(
      '<h2 id="radio">Radio</h2><h2 id="radio-1">Radio</h2><h3 id="radio-1-1">Radio-1</h3>',
    );
  });
});
