// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

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

test("focuses the destination H1 after forward, Back, and Forward route changes", () => {
  const { rerender } = render(<RouteFocusManager />);
  const heading = document.querySelector("h1")!;

  for (const pathname of ["/profile/road-journal", "/profile", "/profile/road-journal"]) {
    act(() => {
      route.pathname = pathname;
      rerender(<RouteFocusManager />);
    });
    expect(document.activeElement).toBe(heading);
    heading.blur();
  }
});
