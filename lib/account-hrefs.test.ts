import { describe, expect, test } from "vitest";
import {
  FORGOT_PASSWORD_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  forgotPasswordHref,
  redirectUrlFrom,
  safeReturnPath,
  signInHref,
  signUpHref,
} from "./account-hrefs";

describe("account hrefs", () => {
  test("point at the sign-in, sign-up, and forgot-password pages", () => {
    expect(SIGN_IN_PATH).toBe("/sign-in");
    expect(SIGN_UP_PATH).toBe("/sign-up");
    expect(FORGOT_PASSWORD_PATH).toBe("/forgot-password");
    expect(signInHref("/")).toBe("/sign-in?redirect_url=%2F");
    expect(signUpHref("/activate")).toBe("/sign-up?redirect_url=%2Factivate");
    expect(forgotPasswordHref("/activate")).toBe("/forgot-password?redirect_url=%2Factivate");
  });

  test("keep the query string, so /activate?code= comes back with its code", () => {
    expect(signInHref("/activate?code=ABCD-1234")).toBe("/sign-in?redirect_url=%2Factivate%3Fcode%3DABCD-1234");
    expect(forgotPasswordHref("/activate?code=ABCD-1234")).toBe(
      "/forgot-password?redirect_url=%2Factivate%3Fcode%3DABCD-1234",
    );
  });

  test("leave off redirect_url when already on an account page with none to keep", () => {
    expect(signInHref("/sign-in")).toBe("/sign-in");
    expect(signInHref("/sign-in/factor-one")).toBe("/sign-in");
    expect(signInHref(null)).toBe("/sign-in");
    expect(signUpHref("/sign-up")).toBe("/sign-up");
    expect(signInHref("/sign-up")).toBe("/sign-in");
    expect(forgotPasswordHref("/sign-in")).toBe("/forgot-password");
    expect(forgotPasswordHref("/forgot-password")).toBe("/forgot-password");
    expect(signInHref("/forgot-password")).toBe("/sign-in");
  });

  test("keep an existing redirect_url when moving between account pages", () => {
    expect(signUpHref("/sign-in?redirect_url=%2Factivate")).toBe("/sign-up?redirect_url=%2Factivate");
    expect(forgotPasswordHref("/sign-in?redirect_url=%2Factivate")).toBe("/forgot-password?redirect_url=%2Factivate");
    expect(signInHref("/forgot-password?redirect_url=%2Fgames")).toBe("/sign-in?redirect_url=%2Fgames");
    expect(forgotPasswordHref("/sign-in?redirect_url=%2Factivate%3Fcode%3DABCD-1234")).toBe(
      "/forgot-password?redirect_url=%2Factivate%3Fcode%3DABCD-1234",
    );
  });

  test("reject unsafe redirect_url values", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/activate?code=ABCD-1234")).toBe("/activate?code=ABCD-1234");
    expect(safeReturnPath("/")).toBe("/");
    expect(redirectUrlFrom("/forgot-password?redirect_url=%2Factivate")).toBe("/activate");
    expect(redirectUrlFrom("/forgot-password?redirect_url=https%3A%2F%2Fevil.example")).toBe("/");
    expect(redirectUrlFrom("/forgot-password")).toBe("/");
    expect(redirectUrlFrom("/activate")).toBe("/activate");
  });
});
