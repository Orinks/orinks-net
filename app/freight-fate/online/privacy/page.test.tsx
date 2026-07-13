import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFatePrivacyPage from "./page";

test("keeps the online features page concise", () => {
  const html = renderToStaticMarkup(<FreightFatePrivacyPage />);

  expect(html).toContain("Freight Fate Online Features");
  expect(html).toContain("Profile sharing");
  expect(html).toContain("Cloud Backup");
  expect(html).toContain("Career statistics come from an accepted Cloud Backup.");
  expect(html).toContain("Previously received data may remain stored and can reappear");
  expect(html).not.toContain("Retention and revocation");
  expect(html).not.toContain("precise route position");
  expect(html).not.toContain("allowlisted career details");
});
