// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { PlayerPage } from "@/lib/wickets-profile";
import { PlayerPageView } from "./page";

afterEach(cleanup);

const full: PlayerPage = {
  name: "Quiet Heron",
  ranked: [{ label: "Safecracker", daily: 1200, weekly: null, monthly: 1500 }],
  specials: ["A test special"],
  fromGame: [{ name: "Safecracker", best: 1500, unlocks: null }],
};

test("shows ranked bests in a table named by its heading", () => {
  render(<PlayerPageView page={full} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Quiet Heron");
  const table = screen.getByRole("table", { name: "Ranked bests" });
  const row = within(table).getByRole("row", { name: /Safecracker/ });
  expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
    expect.stringContaining("1,200"),
    "None",
    expect.stringContaining("1,500"),
  ]);
});

test("lists specials beaten and the game's own numbers, marked as not checked", () => {
  render(<PlayerPageView page={full} />);
  expect(screen.getByRole("heading", { name: "Holiday specials beaten" })).toBeInTheDocument();
  expect(screen.getByRole("listitem")).toHaveTextContent("A test special");
  const table = screen.getByRole("table", { name: "From the game" });
  expect(table).toHaveAccessibleDescription("Sent by the player's game, not checked.");
  expect(document.body.textContent).toContain("Sent by the player's game, not checked.");
  expect(within(table).getAllByRole("cell").at(-1)).toHaveTextContent("None");
});

test("an empty page says so and leaves out the other sections", () => {
  render(<PlayerPageView page={{ name: "New Player", ranked: [], specials: [], fromGame: [] }} />);
  expect(document.body.textContent).toContain("No ranked scores yet.");
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Holiday specials beaten" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "From the game" })).toBeNull();
});
