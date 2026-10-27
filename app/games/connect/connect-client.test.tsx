// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import ConnectClient, { type ClaimFn } from "./connect-client";

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: () => null,
  useMutation: () => vi.fn(),
}));

afterEach(cleanup);

function submit() {
  fireEvent.submit(screen.getByRole("button").closest("form")!);
}

describe("connecting a game", () => {
  test("success names the game and takes focus", async () => {
    const claim: ClaimFn = vi.fn(async () => ({ ok: true as const, game: "dash" }));
    render(<ConnectClient claim={claim} initialCode="WKQR-3468" titles={{ dash: "Coin Dash" }} />);
    submit();
    const heading = await screen.findByRole("heading", { name: "Coin Dash connected" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(claim).toHaveBeenCalledWith({ userCode: "WKQR-3468" });
  });

  test("an unknown code marks the field and moves focus to it", async () => {
    const claim: ClaimFn = vi.fn(async () => ({ ok: false as const, code: "unknown_code" as const }));
    render(<ConnectClient claim={claim} initialCode="" />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "AAAA-AAAA" } });
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not recognised"));
    const field = screen.getByLabelText("Code");
    expect(field).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(field).toHaveFocus());
  });

  test("a new account names its player first, checked before sending", async () => {
    const claim: ClaimFn = vi.fn(async () => ({ ok: false as const, code: "name_taken" as const }));
    render(<ConnectClient claim={claim} initialCode="WKQR-3468" needsName />);
    const name = screen.getByLabelText(/Player name/);
    fireEvent.change(name, { target: { value: "ab" } });
    submit();
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.getByText(/3 to 48 characters\./)).toBeInTheDocument();
    expect(claim).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Ada" } });
    submit();
    await waitFor(() => expect(screen.getAllByText(/already taken/).length).toBeGreaterThan(0));
    expect(claim).toHaveBeenCalledWith({ userCode: "WKQR-3468", displayName: "Ada" });
  });
});
