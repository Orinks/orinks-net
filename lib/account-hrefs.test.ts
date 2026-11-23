import { describe, expect, test } from "vitest";
import { SIGN_IN_PATH, SIGN_UP_PATH, signInHref, signUpHref } from "./account-hrefs";

describe("account hrefs", () => {
  test("point at the sign-in and sign-up pages", () => {
    expect(SIGN_IN_PATH).toBe("/sign-in");
    expect(SIGN_UP_PATH).toBe("/sign-up");
    expect(signInHref("/")).toBe("/sign-in?redirect_url=%2F");
    expect(signUpHref("/activate")).toBe("/sign-up?redirect_url=%2Factivate");
  });

  test("leave off redirect_url when already on that page", () => {
    expect(signInHref("/sign-in")).toBe("/sign-in");
    expect(signInHref("/sign-in/factor-one")).toBe("/sign-in");
    expect(signInHref(null)).toBe("/sign-in");
    expect(signUpHref("/sign-up")).toBe("/sign-up");
  });
});
