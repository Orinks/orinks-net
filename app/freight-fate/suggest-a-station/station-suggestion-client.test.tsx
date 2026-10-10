// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: false,
  driver: null as unknown,
  open: true as boolean | undefined,
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: state.signedIn }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args === "skip") return undefined;
      return getFunctionName(reference) === "freightFateStations:anonymousSuggestionsOpen" ? state.open : state.driver;
    },
    useAction: () => vi.fn(),
  };
});
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => <button type="button">Sign in</button> }));
vi.mock("@/components/turnstile", () => ({ loadTurnstileScript: () => new Promise(() => {}) }));

import { StationSuggestionClient } from "./station-suggestion-client";

beforeEach(() => {
  state.signedIn = false;
  state.driver = null;
  state.open = true;
});

afterEach(cleanup);

test("signed out, the form opens under a prompt for drivers to sign in", () => {
  render(<StationSuggestionClient siteKey="site-key" />);
  expect(screen.getByText("Have a driver? Sign in with its account first.")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Human check" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send suggestion" })).toBeInTheDocument();
});

test("signed in without a driver, the prompt points at the setup page", () => {
  state.signedIn = true;
  render(<StationSuggestionClient siteKey="site-key" />);
  expect(screen.getByRole("link", { name: "Connect it on the online setup page" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send suggestion" })).toBeInTheDocument();
});

test("a signed-in driver gets the form with no human check", () => {
  state.signedIn = true;
  state.driver = { driverId: "road-star-1234" };
  render(<StationSuggestionClient siteKey="site-key" />);
  expect(screen.queryByRole("group", { name: "Human check" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send suggestion" })).toBeInTheDocument();
});

test("until the human check is configured, a visitor is asked to sign in", () => {
  state.open = false;
  render(<StationSuggestionClient siteKey="site-key" />);
  expect(screen.getByRole("heading", { name: "Sign in to suggest a station" })).toBeInTheDocument();
});
