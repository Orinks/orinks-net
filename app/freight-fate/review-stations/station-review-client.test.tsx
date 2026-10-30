// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  { id: "b", name: "The Cat", streamUrl: "https://c.example/live", kind: "terrestrial", held: true, facts: [["Type", "Terrestrial"]] },
  { id: "c", name: "Late Show", streamUrl: "https://l.example/live", facts: [["Type", "Web radio"]] },
];

const decide = vi.fn();

beforeEach(() => {
  decide.mockReset();
  state.actions = {
    "freightFateStations:reviewStationBatch": async () => ({ ok: true, stations }),
    "freightFateStations:decideStationBatch": decide,
    "freightFateStationVetting:checkStationBatch": () => new Promise(() => {}),
  };
});

afterEach(cleanup);

test("accepts the ticked stations and leaves the rest waiting", async () => {
  decide.mockResolvedValue({ ok: true, decided: ["a", "c"], held: [] });
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
  decide.mockResolvedValue({ ok: true, decided: ["a", "b"], held: [] });
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Decline 3 stations" }));
  expect(await screen.findByRole("heading", { name: "Nothing is waiting for review" })).toHaveFocus();
  expect(screen.getByText("Declined 2 stations. 1 station had already been decided.")).toBeInTheDocument();
});

test("a station held for its call sign stays waiting", async () => {
  decide.mockResolvedValue({ ok: true, decided: ["a"], held: ["b"] });
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Night Owl Radio" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "The Cat" }));
  fireEvent.click(screen.getByRole("button", { name: "Accept 2 stations" }));
  expect(
    await screen.findByText("Accepted 1 station. Not accepted: The Cat."),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "2 stations waiting" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "The Cat" })).not.toBeChecked();
});

test("an expired link says so", async () => {
  state.actions["freightFateStations:reviewStationBatch"] = async () => ({ ok: false });
  render(<StationReviewClient token="old" />);
  expect(await screen.findByRole("heading", { name: "This review link does not work" })).toBeInTheDocument();
});

test("shows each stream's check, and says when the check is done", async () => {
  state.actions["freightFateStationVetting:checkStationBatch"] = async () => ({
    ok: true,
    checks: [
      { id: "a", ok: true, text: "Plays (mp3)", playUrl: "https://s.example/live", format: "mp3" },
      { id: "b", ok: false, text: "Fails: the server refused it (error 403)" },
      { id: "c", ok: true, text: "Plays (HLS)", playUrl: "https://l.example/live", format: "hls" },
    ],
  });
  render(<StationReviewClient token="tok" />);
  expect(await screen.findByText("Stream check finished: 2 of 3 stations play.")).toBeInTheDocument();
  expect(screen.getByText("Stream check: Plays (mp3)")).toBeInTheDocument();
  expect(screen.getByText("Stream check: Fails: the server refused it (error 403)")).toBeInTheDocument();
});

test("a station waits on its check while it runs", async () => {
  render(<StationReviewClient token="tok" />);
  await screen.findByRole("heading", { name: "3 stations waiting" });
  expect(screen.getAllByText("Stream check: Checking…")).toHaveLength(3);
});

// jsdom drops the space before a visually hidden span that a browser keeps.
const editOf = (name: string) => new RegExp(`^Edit ?${name}$`);

test("edits a station's stream address, and keeps the form open when it does not play", async () => {
  const change = vi.fn();
  state.actions["freightFateStationVetting:changeStationStream"] = change;
  state.actions["freightFateStations:makeStationWebFromReview"] = vi.fn();
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("button", { name: editOf("The Cat") }));
  const input = screen.getByRole("textbox", { name: "Stream address" });
  expect(input).toHaveFocus();
  expect(input).toHaveValue("https://c.example/live");

  change.mockResolvedValueOnce({ ok: false, problem: "That is not a web address." });
  fireEvent.change(input, { target: { value: "thecat" } });
  fireEvent.click(screen.getByRole("button", { name: "Save address" }));
  expect(await screen.findByText("That is not a web address.")).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-invalid", "true");

  const moved = { ...stations[1], streamUrl: "https://c.example/new" };
  change.mockResolvedValueOnce({ ok: true, station: moved, check: { id: "b", ok: false, text: "Fails: nothing answered" } });
  fireEvent.change(input, { target: { value: "https://c.example/new" } });
  fireEvent.click(screen.getByRole("button", { name: "Save address" }));
  expect(await screen.findByText("Fails: nothing answered")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Stream address" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Stream address" })).toHaveAccessibleDescription("Fails: nothing answered");

  change.mockResolvedValueOnce({
    ok: true,
    station: moved,
    check: { id: "b", ok: true, text: "Plays (MP3)", playUrl: "https://c.example/new", format: "mp3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save address" }));
  expect(await screen.findByText("Plays (MP3)")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Stream address" })).toBeNull();
  expect(screen.getByRole("button", { name: editOf("The Cat") })).toHaveFocus();
  expect(change).toHaveBeenLastCalledWith({ token: "tok", id: "b", streamUrl: "https://c.example/new" });
});

test("makes an AM or FM station web radio", async () => {
  state.actions["freightFateStationVetting:changeStationStream"] = vi.fn();
  state.actions["freightFateStations:makeStationWebFromReview"] = async () => ({
    ok: true,
    station: { ...stations[1], kind: "web", held: false, facts: [["Type", "Web radio"]] },
  });
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("button", { name: editOf("Night Owl Radio") }));
  expect(screen.queryByRole("button", { name: "Make web radio" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: editOf("The Cat") }));
  expect(screen.getAllByRole("textbox", { name: "Stream address" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Make web radio" }));
  expect(await screen.findByText("Web radio now.")).toBeInTheDocument();
  expect(screen.getAllByText("Type: Web radio")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Make web radio" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: editOf("The Cat") })).toHaveFocus());
});

test("Cancel closes the form and returns to Edit", async () => {
  state.actions["freightFateStationVetting:changeStationStream"] = vi.fn();
  state.actions["freightFateStations:makeStationWebFromReview"] = vi.fn();
  render(<StationReviewClient token="tok" />);
  fireEvent.click(await screen.findByRole("button", { name: editOf("The Cat") }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "Stream address" })).toBeNull();
  expect(screen.getByRole("button", { name: editOf("The Cat") })).toHaveFocus();
});
