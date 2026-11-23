// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const signIn = vi.hoisted(() => ({
  status: "needs_first_factor" as string,
  supportedSecondFactors: [] as { strategy: string }[],
  create: vi.fn(),
  resetPasswordEmailCode: {
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    submitPassword: vi.fn(),
  },
  mfa: {
    sendEmailCode: vi.fn(),
    sendPhoneCode: vi.fn(),
    verifyTOTP: vi.fn(),
    verifyEmailCode: vi.fn(),
    verifyPhoneCode: vi.fn(),
    verifyBackupCode: vi.fn(),
  },
  finalize: vi.fn(),
}));

const hookState = vi.hoisted(() => ({
  fetchStatus: "idle" as string,
  errors: {
    fields: { identifier: null as { message: string; longMessage?: string } | null, password: null, code: null },
    global: null,
    raw: null,
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useSignIn: () => ({
    signIn,
    errors: hookState.errors,
    fetchStatus: hookState.fetchStatus,
  }),
}));

const returnPath = vi.hoisted(() => ({ current: "/activate" }));

vi.mock("@/lib/use-return-path", () => ({
  useReturnPath: () => returnPath.current,
}));

import { FORGOT_PASSWORD_COPY, ForgotPasswordForm, clerkMessage } from "./forgot-password-form";

afterEach(() => {
  cleanup();
});

function ok() {
  return { error: null };
}

function fail(message: string) {
  return { error: { message, longMessage: message } };
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submitEmail(email = "pat@example.com") {
  fill(FORGOT_PASSWORD_COPY.emailLabel, email);
  fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.sendCode }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(FORGOT_PASSWORD_COPY.sentCode(email));
  });
}

beforeEach(() => {
  signIn.status = "needs_first_factor";
  signIn.supportedSecondFactors = [];
  hookState.fetchStatus = "idle";
  hookState.errors.fields.identifier = null;
  hookState.errors.fields.password = null;
  hookState.errors.fields.code = null;
  signIn.create.mockReset().mockResolvedValue(ok());
  signIn.resetPasswordEmailCode.sendCode.mockReset().mockResolvedValue(ok());
  signIn.resetPasswordEmailCode.verifyCode.mockReset().mockResolvedValue(ok());
  signIn.resetPasswordEmailCode.submitPassword.mockReset().mockResolvedValue(ok());
  signIn.mfa.sendEmailCode.mockReset().mockResolvedValue(ok());
  signIn.mfa.sendPhoneCode.mockReset().mockResolvedValue(ok());
  signIn.mfa.verifyTOTP.mockReset().mockResolvedValue(ok());
  signIn.mfa.verifyEmailCode.mockReset().mockResolvedValue(ok());
  signIn.mfa.verifyPhoneCode.mockReset().mockResolvedValue(ok());
  signIn.mfa.verifyBackupCode.mockReset().mockResolvedValue(ok());
  signIn.finalize.mockReset().mockResolvedValue(ok());
  signIn.finalize.mockImplementation(async () => {
    signIn.status = "complete";
    return ok();
  });
  returnPath.current = "/activate";
});

describe("clerkMessage", () => {
  test("prefers longMessage and treats missing errors as empty", () => {
    expect(clerkMessage(null)).toBe("");
    expect(clerkMessage({ message: "Short." })).toBe("Short.");
    expect(clerkMessage({ message: "Short.", longMessage: "Longer explanation." })).toBe("Longer explanation.");
  });
});

describe("ForgotPasswordForm", () => {
  test("starts on the email step with a Sign in link that keeps redirect_url", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("heading", { level: 1, name: FORGOT_PASSWORD_COPY.title })).toBeInTheDocument();
    expect(screen.getByLabelText(FORGOT_PASSWORD_COPY.emailLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.sendCode })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FORGOT_PASSWORD_COPY.signIn })).toHaveAttribute(
      "href",
      "/sign-in?redirect_url=%2Factivate",
    );
  });

  test("asks for an email before sending a code", async () => {
    render(<ForgotPasswordForm />);
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.sendCode }));
    expect(await screen.findByRole("alert")).toHaveTextContent(FORGOT_PASSWORD_COPY.enterEmail);
    expect(signIn.create).not.toHaveBeenCalled();
  });

  test("shows a Clerk error when sending the code fails", async () => {
    signIn.create.mockResolvedValue(fail("No account found."));
    render(<ForgotPasswordForm />);
    fill(FORGOT_PASSWORD_COPY.emailLabel, "pat@example.com");
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.sendCode }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No account found.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(FORGOT_PASSWORD_COPY.title);
  });

  test("moves to the code step, sets a password, and continues to the redirect", async () => {
    signIn.resetPasswordEmailCode.submitPassword.mockImplementation(async () => {
      signIn.status = "complete";
      return ok();
    });
    render(<ForgotPasswordForm />);
    await submitEmail();
    expect(signIn.create).toHaveBeenCalledWith({ identifier: "pat@example.com" });
    expect(signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByLabelText(FORGOT_PASSWORD_COPY.codeLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(FORGOT_PASSWORD_COPY.passwordLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(FORGOT_PASSWORD_COPY.confirmLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.resendCode })).toBeInTheDocument();

    fill(FORGOT_PASSWORD_COPY.codeLabel, "123456");
    fill(FORGOT_PASSWORD_COPY.passwordLabel, "new-password-ok");
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.setPassword }));
    expect(await screen.findByRole("alert")).toHaveTextContent(FORGOT_PASSWORD_COPY.mismatch);
    expect(signIn.resetPasswordEmailCode.verifyCode).not.toHaveBeenCalled();

    fill(FORGOT_PASSWORD_COPY.confirmLabel, "new-password-ok");
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.setPassword }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: FORGOT_PASSWORD_COPY.successTitle })).toBeInTheDocument();
    });
    expect(signIn.resetPasswordEmailCode.verifyCode).toHaveBeenCalledWith({ code: "123456" });
    expect(signIn.resetPasswordEmailCode.submitPassword).toHaveBeenCalledWith({
      password: "new-password-ok",
      signOutOfOtherSessions: true,
    });
    expect(signIn.finalize).toHaveBeenCalledTimes(1);
    expect(screen.getByText(FORGOT_PASSWORD_COPY.successBody)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FORGOT_PASSWORD_COPY.continue })).toHaveAttribute("href", "/activate");
    expect(screen.queryByRole("link", { name: FORGOT_PASSWORD_COPY.signIn })).not.toBeInTheDocument();
  });

  test("resends a code and announces it", async () => {
    render(<ForgotPasswordForm />);
    await submitEmail();
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.resendCode }));
    expect(await screen.findByRole("status")).toHaveTextContent(FORGOT_PASSWORD_COPY.resent);
    expect(signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(2);
  });

  test("asks for a second factor when Clerk requires it, then finishes", async () => {
    signIn.resetPasswordEmailCode.submitPassword.mockImplementation(async () => {
      signIn.status = "needs_second_factor";
      signIn.supportedSecondFactors = [{ strategy: "totp" }];
      return ok();
    });
    signIn.mfa.verifyTOTP.mockImplementation(async () => {
      signIn.status = "complete";
      return ok();
    });
    render(<ForgotPasswordForm />);
    await submitEmail();
    fill(FORGOT_PASSWORD_COPY.codeLabel, "123456");
    fill(FORGOT_PASSWORD_COPY.passwordLabel, "new-password-ok");
    fill(FORGOT_PASSWORD_COPY.confirmLabel, "new-password-ok");
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.setPassword }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: FORGOT_PASSWORD_COPY.secondFactorTitle })).toBeInTheDocument();
    });
    fill(FORGOT_PASSWORD_COPY.codeLabel, "654321");
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.verify }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: FORGOT_PASSWORD_COPY.successTitle })).toBeInTheDocument();
    });
    expect(signIn.mfa.verifyTOTP).toHaveBeenCalledWith({ code: "654321" });
    expect(signIn.finalize).toHaveBeenCalledTimes(1);
  });

  test("requires a code and a new password before talking to Clerk", async () => {
    render(<ForgotPasswordForm />);
    await submitEmail();
    fireEvent.click(screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.setPassword }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((node) => node.textContent)).toEqual([
      FORGOT_PASSWORD_COPY.enterCode,
      FORGOT_PASSWORD_COPY.enterPassword,
    ]);
    expect(signIn.resetPasswordEmailCode.verifyCode).not.toHaveBeenCalled();
  });
});
