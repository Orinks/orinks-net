// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const DRIVER = {
  driverId: "road-star-1234", displayName: "Road Star", visibility: "public",
  sharingEnabled: false, hasToken: true, needsRename: false,
};
const COMPUTERS = {
  computers: [{ id: "dt1", label: "Laptop", createdAt: 1751000000000, lastUsedAt: null }],
  hasLegacyToken: true,
};

// A mutable stand-in for the two reactive queries. Convex's useQuery re-renders
// when the backend row changes; the mocked one below subscribes to `notify`,
// so a test can make the driver appear after a mutation resolves the way the
// real query does.
const store = vi.hoisted(() => ({
  driver: null as unknown,
  computers: null as unknown,
  provision: vi.fn(),
  removeComputer: vi.fn(),
  listeners: new Set<() => void>(),
}));

function notify() {
  for (const listener of store.listeners) {
    listener();
  }
}

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { username: "Road Star" } }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  const { useEffect, useState } = await import("react");
  return {
    // The page runs two queries; dispatch on the function name so each gets
    // its own shape.
    useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((count) => count + 1);
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      }, []);
      return getFunctionName(reference) === "freightFate:getMyComputers"
        ? store.computers
        : store.driver;
    },
    useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(reference) === "freightFate:provisionDriver"
        ? store.provision
        : store.removeComputer,
  };
});
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => null }));

import { FreightFateSetupClient, shouldAnnounceDriverReady } from "./setup-client";

beforeEach(() => {
  store.driver = DRIVER;
  store.computers = COMPUTERS;
  store.provision = vi.fn();
  store.removeComputer = vi.fn();
  store.listeners.clear();
});

// Vitest does not run with globals enabled in this repo, so
// @testing-library/react's auto-cleanup never registers.
afterEach(cleanup);

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
  // There is no add-computer form anymore -- a computer is added by
  // activating it from the game, not from a button on this page.
  expect(html).not.toContain('for="new-computer-name"');
  expect(html).toContain("Set up this computer with orinks.net");
  // The full sign-out is present, plainly labelled, and not pre-armed.
  expect(html).toContain("Sign out all computers");
  expect(html).not.toContain("Confirm: sign out all computers");
  // The one-token copy is gone.
  expect(html).not.toContain("Rotate token");
});

test("no remaining control promises a token", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  // Both buttons used to promise a token the page would show; neither does
  // anymore, and nothing on the page ever displays one.
  expect(html).not.toContain("get its token");
  expect(html).not.toContain("get a new token");
  expect(html).not.toContain("Add computer");
});

test("driver readiness announces only on the first resolved query state", () => {
  expect(shouldAnnounceDriverReady(false, undefined)).toBe(false);
  expect(shouldAnnounceDriverReady(false, null)).toBe(true);
  expect(shouldAnnounceDriverReady(true, { displayName: "Updated after save" })).toBe(false);
});

test("does not display a Driver ID and has no copy buttons", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  expect(html).not.toContain("road-star-1234");
  expect(html).not.toContain("Driver ID");
  expect(html).not.toContain("Copy");
});

/** Sets up the page as a signed-in account with no driver yet, and returns a
 * function that plays the reactive queries catching up after the mutation --
 * which is when the real getMyDriver resolves, not before. */
function asBrandNewAccount(provisionResult: Record<string, unknown>) {
  store.driver = null;
  store.computers = null;
  store.provision = vi.fn().mockResolvedValue(provisionResult);

  return async function driverAppears() {
    await act(async () => {
      store.driver = { ...DRIVER, hasToken: false };
      store.computers = { computers: [], hasLegacyToken: false };
      notify();
    });
  };
}

async function submitNewDriver() {
  render(<FreightFateSetupClient />);
  fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
  fireEvent.click(screen.getByRole("button", { name: /set up driver/i }));
  await waitFor(() => expect(store.provision).toHaveBeenCalled());
}

// The regression this pins: the page used to decide "this was a creation, not
// an edit" by looking for a token in the mutation's reply. Nothing mints a
// token at sign-up anymore, so that signal is permanently false -- and with
// it, silently, the focus move that hands a screen reader user the computer
// list they just unlocked. Sighted review would never catch that.
test("creating a driver moves focus to the computer list, with no token in the reply", async () => {
  const driverAppears = asBrandNewAccount({ driverId: "road-star-1234", rotated: false });

  await submitNewDriver();
  await driverAppears();

  const heading = screen.getByRole("heading", { name: /your computers/i });
  await waitFor(() => expect(heading).toHaveFocus());
  // And the list a brand-new player lands on is genuinely empty: no phantom
  // "My computer -- not used yet" row for a computer that holds nothing.
  expect(screen.getByText(/no computers are connected yet/i)).toBeInTheDocument();
});

test("a token handed back by the server would still never reach the page", async () => {
  // provisionDriver returns no token now. This asserts the page would not
  // display one even if it did -- the property that made the old copy-paste
  // panel a problem in the first place.
  const driverAppears = asBrandNewAccount({
    driverId: "road-star-1234",
    rotated: false,
    token: "ffd_0123456789abcdef0123456789abcdef",
  });

  await submitNewDriver();
  await driverAppears();

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /your computers/i })).toHaveFocus(),
  );
  expect(document.body.innerHTML).not.toMatch(/ffd_/);
  expect(document.body.textContent).not.toMatch(/ffd_/);
});

test("saving an edit to an existing driver leaves focus where the player put it", async () => {
  // The mirror of the test above: an edit must not yank focus down to the
  // computer list, which is not what the player was doing.
  store.provision = vi.fn().mockResolvedValue({ driverId: "road-star-1234", rotated: false });
  render(<FreightFateSetupClient />);

  const save = screen.getByRole("button", { name: /save changes/i });
  save.focus();
  fireEvent.click(save);
  await waitFor(() => expect(store.provision).toHaveBeenCalled());
  await act(async () => notify());

  expect(screen.getByRole("heading", { name: /your computers/i })).not.toHaveFocus();
});
