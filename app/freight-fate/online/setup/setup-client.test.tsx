import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { username: "Road Star" } }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    // The page runs two queries; dispatch on the function name so each gets
    // its own shape.
    useQuery: (reference: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(reference) === "freightFate:getMyComputers"
        ? {
            computers: [
              { id: "dt1", label: "Laptop", createdAt: 1751000000000, lastUsedAt: null },
            ],
            hasLegacyToken: true,
          }
        : {
            driverId: "road-star-1234", displayName: "Road Star", visibility: "public",
            sharingEnabled: false, hasToken: true, needsRename: false,
          },
    useMutation: () => vi.fn(),
  };
});
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => null }));

import { FreightFateSetupClient, shouldAnnounceDriverReady } from "./setup-client";

test("drivers receive one unchecked, labelled profile-sharing control", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  expect(html).toContain("<fieldset");
  expect(html).toContain("Profile sharing");
  expect(html).toContain('id="profileSharing"');
  expect(html).toContain('aria-describedby="profile-sharing-help"');
  expect(html).toContain('<label class="font-semibold text-ink" for="profileSharing">Profile sharing</label>');
  expect(html).toContain("board status");
  expect(html).toContain("road-journal posts");
  expect(html).toContain("achievements");
  expect(html).toContain("Turning it off removes them from public pages.");
  expect(html).toContain("Career statistics come from an accepted Cloud Backup.");
  expect(html).toContain("Your driver name is public while Profile sharing is on.");
  expect(html).toContain("Profile sharing and Cloud Backup details");
  expect(html).not.toContain("precise live location");
  expect(html).not.toContain('id="visibility"');
  expect(html).not.toContain("Unlisted:");
  expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  expect(html).not.toMatch(/id="profileSharing"[^>]*checked/);
  expect(html.match(/role="status"><\/div>/g)?.length).toBe(2);
  expect(html).not.toContain("Loading your driver settings");
});

test("the computer list names every sign-out control and keeps list semantics", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  expect(html).toContain("Your computers");
  // Tailwind strips list styling, so the explicit role keeps readers
  // announcing "list, N items".
  expect(html).toContain('role="list"');
  // Per-row buttons carry the computer's name; the legacy row gets prose
  // instead of its long label.
  expect(html).toContain('aria-label="Sign out Laptop"');
  expect(html).toContain('aria-label="Sign out the original token"');
  expect(html).toContain("Not used yet.");
  expect(html).toContain("Original token (from before this computer list)");
  // The add form is a labelled input, not a bare button.
  expect(html).toContain('<label class="block font-semibold text-ink" for="new-computer-name">');
  expect(html).toContain("Add computer and get its token");
  // The full sign-out is present and not pre-armed.
  expect(html).toContain("Sign out all computers and get a new token");
  expect(html).not.toContain("Confirm: sign out all computers");
  // The one-token copy is gone.
  expect(html).not.toContain("Rotate token");
});

test("driver readiness announces only on the first resolved query state", () => {
  expect(shouldAnnounceDriverReady(false, undefined)).toBe(false);
  expect(shouldAnnounceDriverReady(false, null)).toBe(true);
  expect(shouldAnnounceDriverReady(true, { displayName: "Updated after save" })).toBe(false);
});
