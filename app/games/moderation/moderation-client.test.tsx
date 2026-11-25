// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Case, GameModeration } from "./moderation-client";

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useAction: () => vi.fn(),
}));

afterEach(cleanup);

const game = { id: "wickets", title: "Wicket's" };

const open: Case = {
  id: 7,
  about: { id: "acct-b", handle: "bbbbbbbbbbbbbbbb", name: "Bo" },
  state: "auto",
  outcome: null,
  openedAt: Date.UTC(2026, 10, 25, 12),
  closedAt: null,
  sanction: { chat: "off", until: Date.UTC(2026, 10, 26, 12), reason: "auto" },
  reports: [
    {
      id: 1,
      reporter: { id: "acct-a", name: "Ada", ignored: false },
      counts: true,
      at: Date.UTC(2026, 10, 25, 12),
      kind: "pebbles",
      lines: [{ seq: 4, name: "Bo", text: "a rude line", at: 1 }],
      context: [
        { seq: 3, name: "Ada", text: "good luck", at: 1 },
        { seq: 4, name: "Bo", text: "a rude line", at: 1 },
      ],
      marked: { seq: 4, name: "Bo", text: "a rude line", at: 1 },
      note: null,
    },
  ],
  past: [],
};

describe("the chat reports page", () => {
  test("a case is a heading with its lines, and an action says what it did", async () => {
    const moderate = vi.fn(async () => ({ ok: true }));
    const reload = vi.fn();
    render(<GameModeration cases={[open]} game={game} moderate={moderate} reload={reload} sanctions={[]} />);
    expect(screen.getByRole("heading", { name: "Bo, 1 report" })).toBeInTheDocument();
    expect(screen.getByText("Chat turned off for a day by three reports. Waiting for you.")).toBeInTheDocument();
    expect(screen.getByText(/a rude line \(the line reported\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chat off 7 days: Bo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bo: chat off 7 days."));
    expect(moderate).toHaveBeenCalledWith({ do: "act", case: 7, action: "off-week" });
    expect(reload).toHaveBeenCalled();
  });

  test("with nothing open it says so, and a player's chat can come back on", async () => {
    const moderate = vi.fn(async () => ({ ok: true }));
    render(
      <GameModeration
        cases={[]}
        game={game}
        moderate={moderate}
        reload={() => {}}
        sanctions={[{ id: "acct-b", handle: "b", name: "Bo", until: null, reason: "owner" }]}
      />,
    );
    expect(screen.getByText("No open cases.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chat back on for Bo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bo's chat is back on."));
  });
});
