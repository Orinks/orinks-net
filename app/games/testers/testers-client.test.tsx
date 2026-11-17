// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GameTesters, type SetTesterFn } from "./testers-client";

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: () => null,
  useMutation: () => vi.fn(),
}));

afterEach(cleanup);

const game = { id: "wickets", title: "Wicket's" };

// The page with a list that follows its changes, as the live query does.
function Page({ start, known }: { start: string[]; known: string[] }) {
  const [testers, setTesters] = useState(start);
  const setTester: SetTesterFn = async ({ name, game, tester }) => {
    const found = known.find((k) => k.toLowerCase() === name.toLowerCase());
    if (!found) return { ok: false, code: "no_player" };
    setTesters((list) => (tester ? [...new Set([...list, found])].sort() : list.filter((n) => n !== found)));
    return { ok: true, name: found, game, tester };
  };
  return <GameTesters game={game} setTester={setTester} testers={testers} />;
}

describe("the testers page", () => {
  test("adding a tester says so and clears the field", async () => {
    render(<Page known={["Ada Tester"]} start={[]} />);
    expect(screen.getByText("No testers.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "ada tester" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tester" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ada Tester added."));
    expect(screen.getByLabelText("Player name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Remove Ada Tester" })).toBeInTheDocument();
  });

  test("an unknown name marks the field and keeps focus there", async () => {
    render(<Page known={[]} start={[]} />);
    const field = screen.getByLabelText("Player name");
    fireEvent.change(field, { target: { value: "Nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tester" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nobody is called Nobody."));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
  });

  test("removing moves focus to the next tester, then to the field", async () => {
    render(<Page known={["Ada", "Bo Peep"]} start={["Ada", "Bo Peep"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ada removed."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Bo Peep" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Remove Bo Peep" }));
    await waitFor(() => expect(screen.getByLabelText("Player name")).toHaveFocus());
    expect(screen.getByText("No testers.")).toBeInTheDocument();
  });

  test("an empty name is refused before sending", async () => {
    const setTester = vi.fn();
    render(<GameTesters game={game} setTester={setTester} testers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tester" }));
    expect(screen.getByRole("status")).toHaveTextContent("Type a player name.");
    expect(setTester).not.toHaveBeenCalled();
  });
});
