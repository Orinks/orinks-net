// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/lib/use-return-path", () => ({
  useReturnPath: () => "/sign-in?redirect_url=%2Factivate",
}));

import { SignInForgotPasswordLink } from "./forgot-password-link";

afterEach(() => {
  cleanup();
});

test("links to the forgot-password page and keeps redirect_url", () => {
  render(<SignInForgotPasswordLink />);
  expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password?redirect_url=%2Factivate",
  );
});
