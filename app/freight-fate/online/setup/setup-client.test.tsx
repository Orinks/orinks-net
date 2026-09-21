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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

import {
  connectInstructions,
  FreightFateSetupClient,
  shouldAnnounceDriverReady,
} from "./setup-client";

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

test("an unlisted driver profile is described as shared by link", () => {
  store.driver = { ...DRIVER, visibility: "unlisted", sharingEnabled: true };
  render(<FreightFateSetupClient />);

  expect(screen.getByRole("link", { name: "View your shared-by-link driver profile" }))
    .toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /public driver profile/i }))
    .not.toBeInTheDocument();
});

test("no remaining control promises a token", () => {
  const html = renderToStaticMarkup(<FreightFateSetupClient />);
  // Both buttons used to promise a token the page would show; neither does
  // anymore, and nothing on the page ever displays one.
  expect(html).not.toContain("get its token");
  expect(html).not.toContain("get a new token");
  expect(html).not.toContain("Add computer");
});

// The same site answers on orinks.net and on dev.orinks.net (the staging
// deployment the 1.9 game builds talk to), and the address was hardcoded, so
// staging told players to enter their code on a host that never minted it.
test("the connect instruction names the host serving the page", () => {
  expect(connectInstructions("dev.orinks.net")).toContain("dev.orinks.net/activate");
  expect(connectInstructions("orinks.net")).toContain("orinks.net/activate");
});

// The regression guard that matters: the quoted words are the game's own
// menu item, which is "Set up this computer with orinks.net" in every build
// including the staging-pointed ones. Interpolating the host there would
// name a menu item that does not exist -- unfindable for someone arrowing
// the menu by its spoken label.
test("the quoted menu item keeps the game's own name on every host", () => {
  for (const host of ["orinks.net", "dev.orinks.net", "localhost:3000"]) {
    expect(connectInstructions(host)).toContain(
      'choose "Set up this computer with orinks.net,"',
    );
  }
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

test("name and sharing controls stay frozen until an unresolved save finishes", async () => {
  const pending = deferred<{ driverId: string; rotated: boolean }>();
  store.provision = vi.fn().mockReturnValue(pending.promise);
  render(<FreightFateSetupClient />);

  const name = screen.getByRole("textbox", { name: /driver name/i });
  const sharing = screen.getByRole("checkbox", { name: "Profile sharing" });
  fireEvent.click(sharing);
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

  expect(name).toBeDisabled();
  expect(sharing).toBeDisabled();
  sharing.click();
  expect(sharing).toBeChecked();

  await act(async () => pending.resolve({ driverId: DRIVER.driverId, rotated: false }));
  expect(name).not.toBeDisabled();
  expect(sharing).not.toBeDisabled();
  expect(store.provision).toHaveBeenCalledWith(expect.objectContaining({
    visibility: "public",
    expandedSharingConsent: true,
  }));
});

test("a computer sign-out button is inert while its request is unresolved", async () => {
  const pending = deferred<void>();
  store.removeComputer = vi.fn().mockReturnValue(pending.promise);
  render(<FreightFateSetupClient />);

  fireEvent.click(screen.getByRole("button", { name: "Sign out Laptop" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm sign out of Laptop" }));
  const busy = screen.getByRole("button", { name: "Signing out Laptop" });
  expect(busy).toBeDisabled();
  fireEvent.click(busy);
  expect(store.removeComputer).toHaveBeenCalledTimes(1);

  await act(async () => pending.resolve());
});

test("sign out all is disabled during save without moving focus", async () => {
  const pending = deferred<{ driverId: string; rotated: boolean }>();
  store.provision = vi.fn().mockReturnValue(pending.promise);
  render(<FreightFateSetupClient />);

  const save = screen.getByRole("button", { name: /save changes/i });
  save.focus();
  fireEvent.click(save);
  const signOutAll = screen.getByRole("button", { name: "Sign out all computers" });
  expect(signOutAll).toBeDisabled();
  fireEvent.click(signOutAll);
  expect(store.provision).toHaveBeenCalledTimes(1);
  expect(save).toHaveFocus();

  await act(async () => pending.resolve({ driverId: DRIVER.driverId, rotated: false }));
  expect(signOutAll).not.toBeDisabled();
});

test.each([
  { visibility: "public", sharingEnabled: true },
  { visibility: "unlisted", sharingEnabled: true },
  { visibility: "private", sharingEnabled: false },
] as const)(
  "an ordinary save preserves $visibility visibility without renewing sharing consent",
  async ({ visibility, sharingEnabled }) => {
    store.driver = { ...DRIVER, visibility, sharingEnabled };
    store.provision = vi.fn().mockResolvedValue({ driverId: DRIVER.driverId, rotated: false });
    render(<FreightFateSetupClient />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(store.provision).toHaveBeenCalledTimes(1));

    const payload = store.provision.mock.calls[0]![0];
    expect(payload).toMatchObject({
      displayName: DRIVER.displayName,
      visibility,
      rotateToken: false,
      now: expect.any(Number),
    });
    expect(payload).not.toHaveProperty("expandedSharingConsent");
  },
);

test("the explicit sharing control can change an unlisted profile to private", async () => {
  store.driver = { ...DRIVER, visibility: "unlisted", sharingEnabled: true };
  store.provision = vi.fn().mockResolvedValue({ driverId: DRIVER.driverId, rotated: false });
  render(<FreightFateSetupClient />);

  const sharing = screen.getByRole("checkbox", { name: "Profile sharing" });
  expect(sharing).toBeChecked();
  fireEvent.click(sharing);
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(store.provision).toHaveBeenCalledTimes(1));

  expect(store.provision).toHaveBeenCalledWith(expect.objectContaining({
    visibility: "private",
    expandedSharingConsent: false,
    rotateToken: false,
  }));
});

test.each([
  { visibility: "public", sharingEnabled: true },
  { visibility: "unlisted", sharingEnabled: true },
  { visibility: "private", sharingEnabled: false },
] as const)(
  "signing out every computer preserves $visibility visibility without renewing sharing consent",
  async ({ visibility, sharingEnabled }) => {
    store.driver = { ...DRIVER, visibility, sharingEnabled };
    store.provision = vi.fn().mockResolvedValue({ driverId: DRIVER.driverId, rotated: true });
    render(<FreightFateSetupClient />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out all computers" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: sign out all computers" }));
    await waitFor(() => expect(store.provision).toHaveBeenCalledTimes(1));

    const payload = store.provision.mock.calls[0]![0];
    expect(payload).toMatchObject({
      displayName: DRIVER.displayName,
      visibility,
      rotateToken: true,
      now: expect.any(Number),
    });
    expect(payload).not.toHaveProperty("expandedSharingConsent");
  },
);
