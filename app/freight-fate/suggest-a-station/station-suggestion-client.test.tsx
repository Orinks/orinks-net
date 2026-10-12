// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: false,
  driver: null as unknown,
  open: true as boolean | undefined,
  actions: {} as Record<string, (args: unknown) => Promise<unknown>>,
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
    useAction: (reference: Parameters<typeof getFunctionName>[0]) =>
      state.actions[getFunctionName(reference)] ?? vi.fn(),
  };
});
vi.mock("@/components/AccountControls", () => ({ AccountControls: () => <button type="button">Sign in</button> }));
vi.mock("@/components/turnstile", () => ({ loadTurnstileScript: () => new Promise(() => {}) }));

import { StationSuggestionClient } from "./station-suggestion-client";

beforeEach(() => {
  state.signedIn = false;
  state.driver = null;
  state.open = true;
  state.actions = {};
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

test("a playlist of several stations opens a picker held to the day's allowance", async () => {
  state.signedIn = true;
  state.driver = { driverId: "road-star-1234" };
  const stations = [
    { name: "Jazz FM", streamUrl: "http://a.example/jazz" },
    { name: "Rock FM", streamUrl: "http://a.example/rock" },
    { name: "", streamUrl: "http://a.example/talk" },
  ];
  const sendListed = vi.fn(async () => ({
    ok: true,
    results: [
      { name: "Jazz FM", streamUrl: "http://a.example/jazz", ok: true },
      { name: "", streamUrl: "http://a.example/talk", ok: false, reason: "duplicate_catalog" },
    ],
  }));
  state.actions = {
    "freightFateStationVetting:suggestStationSignedIn": async () => ({
      ok: false,
      reason: "stream_station_list",
      message: "That address is a list of several stations.",
      stations,
      remaining: 2,
    }),
    "freightFateStationVetting:suggestListedStationsSignedIn": sendListed,
  };
  render(<StationSuggestionClient siteKey="site-key" />);
  fireEvent.click(screen.getByRole("radio", { name: "Online only" }));
  fireEvent.change(screen.getByLabelText("Station name"), { target: { value: "Many" } });
  fireEvent.change(screen.getByLabelText("Stream address"), { target: { value: "http://a.example/list.m3u" } });
  fireEvent.click(screen.getByRole("button", { name: "Send suggestion" }));

  expect(await screen.findByRole("heading", { name: "Choose up to 2 of 3 stations" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Station name")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Send stations" }));
  expect(await screen.findByRole("link", { name: "Choose at least one station." })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Jazz FM" })).toHaveAccessibleDescription(/Choose at least one station\./);

  fireEvent.click(screen.getByRole("checkbox", { name: "Jazz FM" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "http://a.example/talk" }));
  const rock = screen.getByRole("checkbox", { name: "Rock FM" });
  expect(rock).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(rock);
  expect(rock).not.toBeChecked();
  expect(screen.getByText("None left", { selector: "[aria-live]" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Send 2 stations" }));
  expect(await screen.findByRole("heading", { name: "1 of 2 stations sent" })).toBeInTheDocument();
  expect(sendListed).toHaveBeenCalledWith({ stations: [stations[0], stations[2]], genre: "", note: "" });
  expect(screen.getByText("Jazz FM: sent")).toBeInTheDocument();
  expect(screen.getByText("http://a.example/talk: already on the dial")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { name: "1 of 2 stations sent" }).parentElement).toHaveFocus());
});
