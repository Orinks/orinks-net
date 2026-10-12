// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  actions: {} as Record<string, (args: unknown) => Promise<unknown>>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: (reference: Parameters<typeof getFunctionName>[0]) => state.actions[getFunctionName(reference)],
  };
});

import { StationReviewClient } from "./station-review-client";

const stations = [
  { id: "a", name: "Night Owl Radio", streamUrl: "https://s.example/live", facts: [["Type", "Web radio"]] },
  { id: "b", name: "The Cat", streamUrl: "https://c.example/live", facts: [["Type", "Terrestrial"]] },
  { id: "c", name: "Late Show", streamUrl: "https://l.example/live", facts: [["Type", "Web radio"]] },
];

const decide = vi.fn();

beforeEach(() => {
  decide.mockReset();
  state.actions = {
    "freightFateStations:reviewStationBatch": async () => ({ ok: true, stations }),
    "freightFateStations:decideStationBatch": decide,
  };
});

afterEach(cleanup);

test("accepts the ticked stations and leaves the rest waiting", async () => {
  decide.mockResolvedValue({ ok: true, decided: ["a", "c"] });
  render(<StationReviewClient token="tok" />);
  expect(await screen.findByRole("heading", { name: "3 stations waiting" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose at least one station.");
  expect(decide).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("checkbox", { name: "Night Owl Radio" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Late Show" }));
  fireEvent.click(screen.getByRole("button", { name: "Accept 2 stations" }));
  expect(await screen.findByText("Accepted 2 stations.")).toBeInTheDocument();
  expect(decide).toHaveBeenCalledWith({ token: "tok", ids: ["a", "c"], decision: "accepted" });
  expect(screen.getByRole("heading", { name: "1 station waiting" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "The Cat" })).not.toBeChecked();
});

test("select all, then decline everything, ends on nothing waiting", async () => {
  decide.mockResolvedValue({ ok: true, decided: ["a", "b"] });
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Decline 3 stations" }));
  expect(await screen.findByRole("heading", { name: "Nothing is waiting for review" })).toHaveFocus();
  expect(screen.getByText("Declined 2 stations. 1 station had already been decided.")).toBeInTheDocument();
});

test("an expired link says so", async () => {
  state.actions["freightFateStations:reviewStationBatch"] = async () => ({ ok: false });
  render(<StationReviewClient token="old" />);
  expect(await screen.findByRole("heading", { name: "This review link does not work" })).toBeInTheDocument();
});
