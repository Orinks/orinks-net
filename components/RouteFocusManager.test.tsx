// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/start", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => ({ toString: () => route.search }),
}));

import { RouteFocusManager } from "./RouteFocusManager";

beforeEach(() => {
  route.pathname = "/start";
  route.search = "";
  document.body.innerHTML = '<main><h1 tabindex="-1">Destination</h1></main>';
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("focuses the destination H1 after forward, Back, and Forward route changes", () => {
  const { rerender } = render(<RouteFocusManager />);

  for (const pathname of ["/profile/road-journal", "/profile", "/profile/road-journal"]) {
    const heading = document.createElement("h1");
    heading.textContent = pathname;
    document.querySelector("h1")?.replaceWith(heading);
    act(() => {
      route.pathname = pathname;
      rerender(<RouteFocusManager />);
    });
    expect(document.activeElement).toBe(heading);
    heading.blur();
  }
});

test("focuses the destination H1 when it mounts after the route changes", async () => {
  const { rerender } = render(<RouteFocusManager />);

  document.querySelector("h1")?.remove();
  act(() => {
    route.pathname = "/profile/road-journal";
    rerender(<RouteFocusManager />);
  });

  const heading = document.createElement("h1");
  heading.textContent = "Road journal";
  document.querySelector("main")?.append(heading);

  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(heading.tabIndex).toBe(-1);
});

test("does not steal focus when focus moves before the H1 mounts", async () => {
  const { rerender } = render(<RouteFocusManager />);

  document.body.innerHTML = '<main><button type="button">Open menu</button></main>';
  act(() => {
    route.pathname = "/profile/road-journal";
    rerender(<RouteFocusManager />);
  });

  const button = document.querySelector("button")!;
  button.focus();

  const heading = document.createElement("h1");
  heading.textContent = "Road journal";
  document.querySelector("main")?.prepend(heading);

  await act(async () => Promise.resolve());
  expect(document.activeElement).toBe(button);
});

test.each([
  ["keyboard", () => new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })],
  ["pointer", () => new PointerEvent("pointerdown", { bubbles: true })],
  ["click", () => new MouseEvent("click", { bubbles: true })],
  ["wheel", () => new WheelEvent("wheel", { bubbles: true })],
])("does not focus a delayed H1 after %s input", async (_label, createEvent) => {
  const { rerender } = render(<RouteFocusManager />);
  document.querySelector("h1")?.remove();

  act(() => {
    route.pathname = "/profile/road-journal";
    rerender(<RouteFocusManager />);
  });
  document.body.dispatchEvent(createEvent());

  const heading = document.createElement("h1");
  heading.textContent = "Road journal";
  document.querySelector("main")?.append(heading);
  await act(async () => Promise.resolve());

  expect(document.activeElement).not.toBe(heading);
});

test("waits for a stale outgoing H1 to be replaced", async () => {
  const { rerender } = render(<RouteFocusManager />);
  const outgoingHeading = document.querySelector("h1")!;

  act(() => {
    route.pathname = "/profile/road-journal";
    rerender(<RouteFocusManager />);
  });
  expect(document.activeElement).not.toBe(outgoingHeading);

  const destinationHeading = document.createElement("h1");
  destinationHeading.textContent = "Road journal";
  outgoingHeading.replaceWith(destinationHeading);

  await waitFor(() => expect(document.activeElement).toBe(destinationHeading));
});

test("stops waiting after the bounded focus window", async () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<RouteFocusManager />);
    document.querySelector("h1")?.remove();

    act(() => {
      route.pathname = "/profile/road-journal";
      rerender(<RouteFocusManager />);
    });
    act(() => vi.advanceTimersByTime(1500));

    const lateHeading = document.createElement("h1");
    lateHeading.textContent = "Road journal";
    document.querySelector("main")?.append(lateHeading);
    await act(async () => Promise.resolve());

    expect(document.activeElement).not.toBe(lateHeading);
  } finally {
    vi.useRealTimers();
  }
});
