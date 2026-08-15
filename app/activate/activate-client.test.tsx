// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  LETTERS_ERROR,
  NAME_RULES_HREF,
  NAME_RULES_LINK_TEXT,
  TAKEN_ERROR,
} from "@/lib/freight-fate-driver-name";

// requirement 9 needs ActivateGate, the wrapper that queries driver state.
// It calls useUser/useQuery/useMutation for real, so those modules are
// mocked here the same way app/freight-fate/online/setup/setup-client.test.tsx
// mocks them for DriverSetup -- ActivateClient (the plain component every
// other test in this file renders directly) never touches these hooks, so
// mocking them at module scope does not change its behavior.
//
// Read this before trusting these tests about requirement 9: mocking
// convex/react wholesale replaces the real provider, so nothing in this file
// exercises ConvexProviderWithClerk's actual timing -- that it calls
// setAuth only once Clerk resolves, so a query subscribed on mount runs
// unauthenticated first and getMyDriver answers null before any real answer
// exists. That is a browser-only behaviour and it is why ActivateGate skips
// the query until useConvexAuth reports isAuthenticated. What the mock below
// CAN pin is the wiring: "skip" is honoured the way the real useQuery
// honours it, and store.authenticated drives it. A regression that reached
// for the query before authentication would still pass every test here if
// the mock returned the driver regardless of args -- hence the skip handling.
const store = vi.hoisted(() => ({
  driver: null as unknown,
  authenticated: true,
  claim: vi.fn(),
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
  const { useEffect, useState } = await import("react");
  return {
    useConvexAuth: () => ({
      isAuthenticated: store.authenticated,
      isLoading: !store.authenticated,
    }),
    useQuery: (_query: unknown, args: unknown) => {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((count) => count + 1);
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      }, []);
      // The real useQuery returns undefined for a skipped query -- it never
      // subscribes at all. Mirrored here so a component that stopped
      // skipping would visibly change behaviour in these tests.
      return args === "skip" ? undefined : store.driver;
    },
    useMutation: () => store.claim,
  };
});
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => null }));

import ActivateClient, { ActivateGate } from "./activate-client";

beforeEach(() => {
  store.driver = null;
  store.authenticated = true;
  store.claim = vi.fn();
  store.listeners.clear();
});

// Vitest does not run with globals enabled in this repo, so
// @testing-library/react's auto-cleanup (which detects a global `afterEach`)
// never registers. Without this, each render() in this file would pile up
// in the same document and every query would find duplicates from earlier
// tests.
afterEach(cleanup);

describe("ActivateClient", () => {
  test("pre-fills the code from the query string", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="WKQR-3468" />);
    expect(screen.getByLabelText(/activation code/i)).toHaveValue("WKQR-3468");
  });

  test("labels both fields and submits exactly what was typed, untransformed", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient claim={claim} initialCode="" />);

    fireEvent.change(screen.getByLabelText(/activation code/i), {
      target: { value: "wkqr-3468" },
    });
    fireEvent.change(screen.getByLabelText(/name this computer/i), {
      target: { value: "Studio desktop" },
    });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith({ userCode: "wkqr-3468", label: "Studio desktop" }),
    );
  });

  // a11y requirement 1: the error element is always mounted; only its text
  // changes. A live region must already be in the tree before its content
  // changes, or the change is missed (the brief's `{error ? <p role="alert">
  // : null}` draft was flagged as a defect for exactly this reason).
  test("mounts the error alert once, before any submit, and never remounts it once an error appears", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "unknown_code" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(alert.textContent).not.toBe(""));

    // Reference equality, not just a passing query: if the element were ever
    // conditionally mounted (the brief's `{error ? <p role="alert"> : null}`
    // draft), React would tear down and recreate this node, so the captured
    // reference above would be stale by the time the query below runs. Same
    // node proves it was already in the tree before its text changed.
    expect(screen.getByRole("alert")).toBe(alert);
  });

  // a11y requirement 2: success moves focus to a tabIndex={-1} heading via a
  // ref in a useEffect keyed on the success flag, so focus never drops to
  // <body> the moment the page succeeds (the brief's draft unmounted the
  // whole form on success, which does exactly that).
  test("moves focus to the confirmation heading on success", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const heading = await screen.findByRole("heading", { name: /connected/i });
    await waitFor(() => expect(heading).toHaveFocus());

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/return to freight fate/i);
  });

  // a11y requirement 3: busy state is spoken, not just displayed. "Connecting…"
  // must be in a polite live region before the request settles -- a player
  // who submitted with Enter from the code field never sees button text.
  test("announces connecting in a live region before the request settles", async () => {
    let resolveClaim: (value: { ok: true }) => void = () => {};
    const claim = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/connecting/i);

    resolveClaim({ ok: true });
    await screen.findByRole("heading", { name: /connected/i });
  });

  // a11y requirement 4: the double-submit guard is aria-disabled plus a
  // `if (busy) return;` guard clause -- never the native `disabled`
  // attribute, which can drop focus to <body> on a click-triggered disable.
  test("two rapid clicks call claim once; the button stays keyboard-operable", () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    const button = screen.getByRole("button", { name: /connect/i });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  // a11y requirement 5 (branch one): unknown_code is a field problem -- mark
  // the field invalid and move focus there.
  test("an unknown code marks the field invalid and moves focus to it", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "unknown_code" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/expired|not recognised|not recognized/i);

    const field = screen.getByLabelText(/activation code/i);
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  // a11y requirement 5 (branch two): the other three codes are session-state
  // problems, not code problems -- retyping fixes nothing, so the field must
  // NOT be marked invalid, and focus goes to the alert instead.
  test("a too-many-computers error does not blame the code field", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "too_many_computers" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/maximum number of computers/i);
    await waitFor(() => expect(alert).toHaveFocus());

    expect(screen.getByLabelText(/activation code/i)).not.toHaveAttribute("aria-invalid");
  });

  // The setup page's buttons say "Sign out" and have never said "Remove",
  // so an instruction to remove a computer sends a screen reader user
  // searching that page for a word that is not on it (armstrong445, 2026-08-15).
  test("the computer cap names the control the setup page actually has", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "too_many_computers" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sign out/i);
    expect(alert).not.toHaveTextContent(/remove/i);
  });

  // The fix for this failure lives on another page, and focus is already on
  // the alert -- so the link out of it is the next Tab stop, not a hunt.
  test("the computer cap links to the setup page from inside the alert", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "too_many_computers" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    const link = within(alert).getByRole("link", { name: /your computers/i });
    expect(link).toHaveAttribute("href", "/freight-fate/online/setup");
  });

  // The alert is sr-only until something goes wrong, and sr-only is
  // clip-based: an always-mounted link inside it would be an invisible tab
  // stop sitting ahead of the code field on every clean page load.
  test("the alert holds no link until a failure puts one there", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "unknown_code" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);

    const alert = screen.getByRole("alert");
    expect(within(alert).queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(alert.textContent).not.toBe(""));
    // A wrong code is fixed on this page, so it gets no link either.
    expect(within(alert).queryByRole("link")).toBeNull();
  });

  test("a rate-limited claim gets its own message", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "rate_limited" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/too many attempts|wait a minute/i));
  });

  // a11y requirement 6: no autofocus on mount, prefilled or not -- autofocus
  // would skip the heading and instructions on a one-shot interaction.
  test("does not autofocus the code field even when it is prefilled", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="WKQR-3468" />);
    expect(document.activeElement).toBe(document.body);
  });

  // a11y requirement 7: initialCode is confirmed in plain reading-order text
  // before the field, not a live region -- a field filled in after the
  // reader already passed it is filled silently.
  test("confirms a prefilled code in plain reading-order text, not a live region", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="WKQR-3468" />);
    const confirmation = screen.getByText(/we received a code from freight fate/i);
    expect(confirmation).toHaveTextContent(/WKQR-3468/i);
    expect(confirmation).not.toHaveAttribute("role", "status");
    expect(confirmation).not.toHaveAttribute("role", "alert");
    expect(confirmation.closest('[role="status"]')).toBeNull();
    expect(confirmation.closest('[role="alert"]')).toBeNull();

    // The whole point of requirement 7 is "before the field" -- a
    // confirmation a reader reaches after the field is useless, since they
    // have already typed by the time they hear it. DOCUMENT_POSITION_FOLLOWING
    // means the field comes after the confirmation in document order.
    const field = screen.getByLabelText(/activation code/i);
    expect(confirmation.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // a11y requirement 8: one plain text input, tied to persistent hint text
  // (not a placeholder) via aria-describedby joined with the error id;
  // spellCheck off, autoCorrect off, no numeric/tel inputMode since the code
  // contains letters.
  test("ties the code field to persistent hint text and avoids voice/keyboard traps", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" />);
    const field = screen.getByLabelText(/activation code/i);
    const alert = screen.getByRole("alert");

    const describedBy = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(describedBy).toContain(alert.id);
    const hintId = describedBy.find((id) => id !== alert.id);
    expect(hintId).toBeTruthy();
    const hint = hintId ? document.getElementById(hintId) : null;
    expect(hint).not.toBeNull();
    expect(hint?.textContent?.length).toBeGreaterThan(0);

    expect(field).not.toHaveAttribute("placeholder");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field.getAttribute("inputmode")).not.toBe("numeric");
    expect(field.getAttribute("inputmode")).not.toBe("tel");
  });

  // The hint only helps someone typing. When the game handed the code over in
  // the URL there is nothing to type, so it must not be read out on every
  // focus of a field nobody edits.
  test("drops the format hint when the code arrived pre-filled", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="WKQR-3468" />);
    const field = screen.getByLabelText(/activation code/i);
    const alert = screen.getByRole("alert");

    expect(screen.queryByText(/the dash is optional/i)).not.toBeInTheDocument();
    const describedBy = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    // The error region stays wired up; only the hint goes.
    expect(describedBy).toEqual([alert.id]);
  });

  test("never renders the code field as a segmented one-character-per-box control", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" />);
    expect(screen.getAllByLabelText(/activation code/i)).toHaveLength(1);
    expect(screen.getByLabelText(/activation code/i).tagName).toBe("INPUT");
  });
});

// a11y requirement 9: ActivateGate gates rendering on driver state, the same
// way it already gates on sign-in. Until the getMyDriver query resolves,
// neither shape (two-field or three-field) may render, and the third
// sr-only status state ("Checking your driver…") must live inside the same
// focused region that the sign-in transition already moves focus to.
describe("ActivateGate", () => {
  test("renders no fields while the driver query is pending, then exactly one shape once it resolves", async () => {
    store.driver = undefined; // Convex's "still loading" value.
    render(<ActivateGate initialCode="" />);

    // Neither shape has rendered: no inputs of any kind exist yet.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    const region = screen.getByRole("region", { name: /freight fate activation/i });
    expect(region).toHaveTextContent(/checking your driver/i);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/checking your driver/i);
    // The status announcement must live inside the region that the sign-in
    // transition already focused, not beside it -- a reader whose cursor
    // followed that focus move would never reach an announcement rendered
    // outside it.
    expect(region.contains(status)).toBe(true);

    await act(async () => {
      store.driver = null; // Resolved: signed-in account, no driver yet.
      notify();
    });

    // Exactly one shape appears -- the three-field shape, since driver
    // resolved to null -- and the field count never having been anything
    // else first is the point of the gate.
    expect(screen.getByLabelText(/driver name/i)).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });

  // Requirement 9, the browser case: Clerk reporting signed-in is not the
  // same as Convex holding a token. Until useConvexAuth reports
  // isAuthenticated, the query must be skipped -- an unauthenticated run of
  // getMyDriver answers null, and rendering on that would paint the
  // three-field shape for a returning player who has a driver, then swap to
  // two fields when the authenticated answer landed. Here the driver exists
  // the whole time; the point is that nothing renders until the answer is
  // an authenticated one, and that the field count goes 0 -> 2, never
  // 0 -> 3 -> 2.
  test("renders nothing until Convex is authenticated, even though Clerk already reports signed in", async () => {
    store.authenticated = false;
    store.driver = { driverId: "road-star-1234", displayName: "Road Star" };
    render(<ActivateGate initialCode="" />);

    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    const region = screen.getByRole("region", { name: /freight fate activation/i });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/checking your driver/i);
    expect(region.contains(status)).toBe(true);

    await act(async () => {
      store.authenticated = true;
      notify();
    });

    expect(screen.queryByLabelText(/driver name/i)).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  test("renders the two-field shape once the driver query resolves to an existing driver", async () => {
    store.driver = { driverId: "road-star-1234", displayName: "Road Star" };
    render(<ActivateGate initialCode="" />);

    expect(await screen.findByLabelText(/activation code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/driver name/i)).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  // Fix round 1, finding 1: once the driver query resolves, ActivateGate's
  // own accountStatus div and ActivateClient's busy-status div are BOTH
  // mounted with role="status" at the same time. Today that is safe only
  // because the two are never non-empty together -- nothing enforced that.
  // This drives a real submit through an unresolved claim promise so the
  // busy announcement is live at the same moment accountStatus is mounted,
  // and checks the actual invariant requirement 9 exists to protect: at
  // most one role="status" element carries text at any moment, across idle,
  // busy, and post-resolve.
  test("at most one role=status element has non-empty text at a time, across idle, busy, and resolved", async () => {
    store.driver = null; // Resolved before mount: shape B, accountStatus already "".
    let resolveClaim: (value: { ok: true }) => void = () => {};
    store.claim = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    render(<ActivateGate initialCode="WKQR-3468" />);

    function nonEmptyStatusCount() {
      return screen
        .getAllByRole("status")
        .filter((element) => (element.textContent ?? "").trim().length > 0).length;
    }

    // Idle: the driver query has already resolved, so both ActivateGate's
    // accountStatus div and ActivateClient's busy-status div are mounted --
    // and both are empty.
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);
    expect(nonEmptyStatusCount()).toBe(0);

    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    // Busy: ActivateClient's status div now carries "Setting up and
    // connecting…" while ActivateGate's accountStatus div is still mounted
    // alongside it (empty, since the driver query already settled). Two
    // role="status" elements exist at once here -- the invariant is that
    // only one of them ever has text.
    await waitFor(() => expect(nonEmptyStatusCount()).toBe(1));

    resolveClaim({ ok: true });
    await screen.findByRole("heading", { name: /connected/i });

    // Resolved: the success panel is its own role="status" region: still at
    // most one non-empty status element in the tree.
    expect(nonEmptyStatusCount()).toBeLessThanOrEqual(1);
  });
});

// a11y requirements 10-16: the three-field shape rendered by ActivateClient
// itself (needsDriver=true), tested the same way as requirements 1-8 above
// -- an injected `claim`, no Convex/Clerk providers required.
describe("ActivateClient — three-field shape (needsDriver)", () => {
  // a11y requirement 10: the shape announces itself in plain reading-order
  // text before any field, uses its own H2 (not a repeat of the page's H1,
  // "Activate Freight Fate" from app/activate/page.tsx's PageHeader), places
  // the driver-name field between the code field and the computer-name
  // field, and never wraps the three unrelated fields in a <fieldset> --
  // that would announce a false group boundary.
  test("announces shape B before the code field, with its own H2 and no fieldset", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" needsDriver prefillName="" />);

    const sentence = screen.getByText(/does not have a freight fate driver yet/i);
    const codeField = screen.getByLabelText(/activation code/i);
    expect(
      sentence.compareDocumentPosition(codeField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const nameField = screen.getByLabelText(/driver name/i);
    const computerField = screen.getByLabelText(/name this computer/i);
    expect(
      codeField.compareDocumentPosition(nameField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nameField.compareDocumentPosition(computerField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByRole("group")).toBeNull();

    const heading = screen.getByRole("heading", { name: /create your driver/i });
    expect(heading.textContent).not.toBe("Activate Freight Fate");
  });

  // a11y requirement 11: the name field reuses setup-client's rules from the
  // shared lib/freight-fate-driver-name module rather than reimplementing
  // them, is prefilled from the Clerk username (WCAG 3.3.7), and is never
  // autofocused.
  test("rejects a name with fewer than three letters locally, before any network call", async () => {
    const claim = vi.fn();
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "a12" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    expect(await screen.findByText(LETTERS_ERROR.message)).toBeInTheDocument();
    expect(claim).not.toHaveBeenCalled();
  });

  test("a name-taken rejection from the server renders wording identical to the setup page", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "name_taken" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    expect(await screen.findByText(TAKEN_ERROR.message)).toBeInTheDocument();
  });

  test("prefills the driver name from the Clerk username and does not autofocus it", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" needsDriver prefillName="Road Star" />);
    expect(screen.getByLabelText(/driver name/i)).toHaveValue("Road Star");
    expect(document.activeElement).toBe(document.body);
  });

  test("the driver-name field carries the same maxLength, required marking, and rules link as setup", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" needsDriver prefillName="" />);
    const field = screen.getByLabelText(/driver name/i);
    expect(field).toHaveAttribute("maxlength", "48");
    expect(field).toHaveAttribute("aria-required", "true");

    const label = screen.getByText(/driver name/i, { selector: "label" });
    expect(label).toHaveTextContent("*");

    const link = screen.getByRole("link", { name: NAME_RULES_LINK_TEXT });
    expect(link).toHaveAttribute("href", NAME_RULES_HREF);
  });

  // a11y requirement 12: one problem at a time. A name rejection focuses
  // only the name field; a code rejection focuses only the code field;
  // submitting from inside the name field cannot move focus there (it is
  // already there), so that case must announce through the live region
  // instead -- the same already-focused fallback showNameError uses on the
  // setup page.
  test("a name rejection focuses only the name field, leaving the code field untouched", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "name_taken" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    const nameField = screen.getByLabelText(/driver name/i);
    await waitFor(() => expect(nameField).toHaveFocus());
    expect(nameField).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/activation code/i)).not.toHaveAttribute("aria-invalid");
  });

  test("a code rejection focuses only the code field, leaving the name field untouched", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "unknown_code" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    const codeField = screen.getByLabelText(/activation code/i);
    await waitFor(() => expect(codeField).toHaveFocus());
    expect(codeField).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/driver name/i)).not.toHaveAttribute("aria-invalid");
  });

  test("submitting from inside the name field keeps focus there and routes the message to the live region", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: false, code: "name_taken" });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    const nameField = screen.getByLabelText(/driver name/i);
    fireEvent.change(nameField, { target: { value: "Road Star" } });
    nameField.focus();
    fireEvent.submit(nameField.closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(TAKEN_ERROR.message));
    expect(nameField).toHaveFocus();
  });

  // a11y requirement 13: resolved by architecture (one Convex mutation,
  // validation before any write) -- pinned here as "never two calls."
  test("creates the driver and claims the code in a single call, never two", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledWith({
      userCode: "WKQR-3468",
      label: undefined,
      displayName: "Road Star",
    });
  });

  // a11y requirement 14: the three-field shape's submit button names both
  // actions, idle and busy, and someone submitting via Enter from the
  // computer-name field -- who never sees the button -- still hears both
  // actions through the live region.
  test("the submit button names both actions, idle and busy, including via Enter from the computer-name field", async () => {
    let resolveClaim: (value: { ok: true }) => void = () => {};
    const claim = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });

    const button = screen.getByRole("button", { name: /create driver and connect this computer/i });
    const computerField = screen.getByLabelText(/name this computer/i);
    fireEvent.change(computerField, { target: { value: "Laptop" } });
    fireEvent.submit(computerField.closest("form")!);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/setting up and connecting/i);
    expect(button).toHaveTextContent(/setting up and connecting/i);

    resolveClaim({ ok: true });
    await screen.findByRole("heading", { name: /connected/i });
  });

  // a11y requirement 15 (decided): drivers created via /activate default to
  // private/off, and the page never offers a sharing consent decision on a
  // first-run page nobody chose to land on.
  test("never renders a profile-sharing control, and the claim call carries no visibility field", async () => {
    const claim = vi.fn().mockResolvedValue({ ok: true });
    render(<ActivateClient claim={claim} initialCode="WKQR-3468" needsDriver prefillName="" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    // The hint text legitimately mentions profile sharing (reused verbatim
    // from NAME_HINT_SUFFIX, per requirement 11) -- what must not exist is
    // the setup page's own checkbox and its "Profile sharing" legend.
    expect(document.querySelector("legend")).toBeNull();
    expect(document.querySelector("fieldset")).toBeNull();

    fireEvent.change(screen.getByLabelText(/driver name/i), { target: { value: "Road Star" } });
    fireEvent.click(screen.getByRole("button", { name: /create driver/i }));

    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith({
        userCode: "WKQR-3468",
        label: undefined,
        displayName: "Road Star",
      }),
    );
  });

  // a11y requirement 16: restated -- no autofocus on the new field even when
  // prefilled, whether or not the code field also arrived prefilled.
  test("does not autofocus any field, with both the code and the name prefilled", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="WKQR-3468" needsDriver prefillName="Road Star" />);
    expect(document.activeElement).toBe(document.body);
  });
});
