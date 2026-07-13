import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import FreightFateOnlineRulesPage from "./page";

test("keeps the online rules focused on driver names", () => {
  const html = renderToStaticMarkup(<FreightFateOnlineRulesPage />);

  expect(html).toContain("Naming rules");
  expect(html).toContain("What happens if a name breaks the rules");
  expect(html).not.toContain("Fair play online");
  expect(html).not.toContain("Profile sharing controls whether your driver appears online.");
});
