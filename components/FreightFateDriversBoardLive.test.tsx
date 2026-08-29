// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

// A mutable stand-in for the live subscription. The real useQuery re-renders
// when the backend changes; this one re-renders when a test calls push(), so
// a test can make a driver set off or sign off the way the backend would.
const store = vi.hoisted(() => ({
  board: undefined as unknown,
  connection: { hasEverConnected: true, isWebSocketConnected: true },
  listeners: new Set<() => void>(),
}));

vi.mock("convex/react", async () => {
  const { useEffect, useState } = await import("react");
  return {
    ConvexReactClient: class {
      constructor(public url: string) {}
    },
    ConvexProvider: ({ children }: { children: React.ReactNode }) => children,
    useQuery: () => {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((count) => count + 1);
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      }, []);
      return store.board;
    },
    useConvexConnectionState: () => store.connection,
  };
});

import { FreightFateDriversBoardLive } from "./FreightFateDriversBoardLive";

function driver(name: string, overrides: Record<string, unknown> = {}) {
  const driverId = `${name.toLowerCase().replace(/\s+/g, "-")}-1234`;
  return {
    driverId,
    displayName: name,
    activity: "Driving to Denver",
    detail: "reefer, 40% there",
    changedAt: NOW,
    ...overrides,
  };
}

/** Push a new roster down the subscription and let the component settle. */
function push(drivers: ReturnType<typeof driver>[]) {
  act(() => {
    store.board = { drivers };
    for (const listener of store.listeners) {
      listener();
    }
  });
}

/** Let the two-frame clear-then-set in the announcer land. */
function settleSpeech() {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

function spoken() {
  return screen.getByRole("status").textContent;
}

function renderBoard(initial = { drivers: [driver("Road Star")], asOf: NOW }) {
  return render(<FreightFateDriversBoardLive initial={initial} />);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearTimeout", "clearInterval", "requestAnimationFrame", "Date"] });
  vi.setSystemTime(NOW);
  store.board = undefined;
  store.connection = { hasEverConnected: true, isWebSocketConnected: true };
  store.listeners.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("the still frame stands until the subscription answers, then the wording changes", () => {
  renderBoard();

  // Nothing has answered yet: what the server sent, said the way the server
  // said it, still telling the reader to refresh because that is still true.
  expect(screen.getByText(/Refresh the page to check again/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Road Star, driver profile" })).toBeInTheDocument();

  push([driver("Road Star")]);

  expect(screen.queryByText(/Refresh the page to check again/)).toBeNull();
  expect(screen.getByText(/This list updates itself/)).toBeInTheDocument();
});

test("the first live list is not news", () => {
  renderBoard({ drivers: [], asOf: NOW });

  push([driver("Road Star"), driver("Night Owl")]);
  settleSpeech();

  // Two drivers appeared as far as the page is concerned, but that is the
  // page arriving, not two trucks setting off.
  expect(spoken()).toBe("");
});

test("a driver reporting progress says nothing", () => {
  renderBoard();
  push([driver("Road Star")]);
  settleSpeech();

  push([driver("Road Star", { detail: "reefer, 45% there", changedAt: NOW + MINUTE })]);
  settleSpeech();

  // The row is rewritten...
  expect(screen.getByText(/45% there/)).toBeInTheDocument();
  // ...and nobody is told, because nothing happened that a listener wants
  // interrupting for.
  expect(spoken()).toBe("");
});

test("one driver setting off, and one signing off, are each named", () => {
  renderBoard();
  push([driver("Road Star")]);
  settleSpeech();

  push([driver("Road Star"), driver("Night Owl")]);
  settleSpeech();
  expect(spoken()).toBe("Night Owl is on duty.");

  // Past the throttle window, so the next change speaks straight away.
  act(() => {
    vi.advanceTimersByTime(11_000);
  });
  push([driver("Night Owl")]);
  settleSpeech();
  expect(spoken()).toBe("Road Star went off duty.");
});

test("a crowd is counted rather than listed", () => {
  renderBoard({ drivers: [], asOf: NOW });
  push([]);
  settleSpeech();

  push([driver("Road Star"), driver("Night Owl"), driver("Big Rig"), driver("Cold Chain")]);
  settleSpeech();

  expect(spoken()).toBe("4 drivers are on duty.");
});

test("changes inside the throttle window are gathered into one notice", () => {
  renderBoard();
  push([driver("Road Star")]);
  settleSpeech();

  push([driver("Road Star"), driver("Night Owl")]);
  settleSpeech();
  expect(spoken()).toBe("Night Owl is on duty.");

  // A second arrival a moment later must not cut off the first notice.
  push([driver("Road Star"), driver("Night Owl"), driver("Big Rig")]);
  settleSpeech();
  expect(spoken()).toBe("Night Owl is on duty.");

  act(() => {
    vi.advanceTimersByTime(11_000);
  });
  settleSpeech();
  expect(spoken()).toBe("Big Rig is on duty.");
});


test("a truck parked with the game left running drops off on the clock alone", () => {
  renderBoard();
  push([driver("Road Star", { changedAt: NOW })]);
  expect(screen.getByText("1 driver is on duty.")).toBeInTheDocument();

  // Half an hour later the backend has sent nothing -- the row is still
  // there, beating, unchanged. The browser is what notices.
  act(() => {
    vi.setSystemTime(NOW + 31 * MINUTE);
    vi.advanceTimersByTime(31 * MINUTE);
  });

  expect(screen.getByText("No drivers are on duty right now.")).toBeInTheDocument();
});

test("the row under a reader's focus is not taken away from them", () => {
  renderBoard();
  push([driver("Road Star"), driver("Night Owl")]);
  settleSpeech();

  const link = screen.getByRole("link", { name: "Road Star, driver profile" });
  act(() => {
    link.focus();
    fireEvent.focus(link);
  });

  push([driver("Night Owl")]);
  settleSpeech();

  // Still on screen, still holding focus -- but honest about what happened,
  // rather than reading as though the truck were still rolling.
  expect(screen.getByRole("link", { name: "Road Star, driver profile" })).toBe(link);
  expect(screen.getByText(/Went off duty/)).toBeInTheDocument();
  // The count is who is driving, not how many rows are on screen.
  expect(screen.getByText("1 driver is on duty.")).toBeInTheDocument();

  // Once they move on, the row goes.
  act(() => {
    fireEvent.blur(link);
  });
  expect(screen.queryByText("Road Star")).toBeNull();
});

test("losing the connection says so instead of quietly going stale", () => {
  renderBoard();
  push([driver("Road Star")]);
  settleSpeech();

  act(() => {
    store.connection = { hasEverConnected: true, isWebSocketConnected: false };
    for (const listener of store.listeners) {
      listener();
    }
  });
  settleSpeech();

  // Said on screen and, once, out loud.
  expect(screen.getAllByText(/This list has stopped updating/)).toHaveLength(2);
  expect(spoken()).toContain("This list has stopped updating.");
});


test("the list is alphabetical however the backend orders it", () => {
  renderBoard({ drivers: [], asOf: NOW });
  push([driver("Zeta Hauler"), driver("Alpha Hauler"), driver("Mid Hauler")]);
  settleSpeech();

  expect(screen.getAllByRole("listitem").map((row) => row.textContent?.split(":")[0])).toEqual([
    "Alpha Hauler",
    "Mid Hauler",
    "Zeta Hauler",
  ]);
});
