import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { username: "Road Star" } }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    driverId: "road-star-1234", displayName: "Road Star", visibility: "public",
    sharingEnabled: false, hasToken: true, needsRename: false,
  }),
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => null }));

import { FreightFateSetupClient, shouldAnnounceDriverReady } from "./setup-client";

test("legacy drivers receive an unchecked, labelled renewed-consent control", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  expect(html).toContain("<fieldset");
  expect(html).toContain("Sharing preferences");
  expect(html).toContain('id="expandedSharing"');
  expect(html).toContain('aria-describedby="expanded-sharing-help"');
  expect(html).toContain("Share my Freight Fate activity on Orinks");
  expect(html).toContain("live drivers board");
  expect(html).toContain("road-journal events");
  expect(html).toContain("earned achievements");
  expect(html).toContain("last-saved city");
  expect(html).not.toMatch(/id="expandedSharing"[^>]*checked/);
  expect(html.match(/role="status"><\/div>/g)?.length).toBe(2);
  expect(html).not.toContain("Loading your driver settings");
});

test("driver readiness announces only on the first resolved query state", () => {
  expect(shouldAnnounceDriverReady(false, undefined)).toBe(false);
  expect(shouldAnnounceDriverReady(false, null)).toBe(true);
  expect(shouldAnnounceDriverReady(true, { displayName: "Updated after save" })).toBe(false);
});
