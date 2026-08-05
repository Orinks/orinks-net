// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import ActivateClient from "./activate-client";

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

  test("never renders the code field as a segmented one-character-per-box control", () => {
    render(<ActivateClient claim={vi.fn()} initialCode="" />);
    expect(screen.getAllByLabelText(/activation code/i)).toHaveLength(1);
    expect(screen.getByLabelText(/activation code/i).tagName).toBe("INPUT");
  });
});
