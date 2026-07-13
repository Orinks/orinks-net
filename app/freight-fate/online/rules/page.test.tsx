import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFateOnlineRulesPage from "./page";

test("explains online career checks in plain language", () => {
  const html = renderToStaticMarkup(<FreightFateOnlineRulesPage />);

  expect(html).toContain("Your local career is yours.");
  expect(html).toContain("Profile sharing controls whether your driver appears online.");
  expect(html).toContain("orinks.net has checked and accepted");
  expect(html).toContain("nothing changes on your computer");
  expect(html).not.toContain("schema and arithmetic");
  expect(html).not.toContain("integrity");
});
