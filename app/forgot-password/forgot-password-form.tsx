"use client";

import { useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { redirectUrlFrom, signInHref } from "@/lib/account-hrefs";
import { useReturnPath } from "@/lib/use-return-path";

export const FORGOT_PASSWORD_COPY = {
  title: "Forgot password",
  emailLabel: "Email",
  sendCode: "Send code",
  sending: "Sending…",
  signIn: "Sign in",
  sentCode: (email: string) => `We sent a code to ${email}`,
  codeLabel: "Code",
  passwordLabel: "New password",
  confirmLabel: "Confirm new password",
  setPassword: "Set password",
  settingPassword: "Setting password…",
  resendCode: "Resend code",
  resent: "We sent another code.",
  successTitle: "Password updated",
  successBody: "You are signed in.",
  continue: "Continue",
  enterEmail: "Enter your email.",
  enterCode: "Enter the code we sent.",
  enterPassword: "Enter a new password.",
  mismatch: "Passwords do not match.",
  secondFactorTitle: "Enter a verification code",
  verify: "Verify",
  verifying: "Verifying…",
  couldNotReset: "Could not reset the password.",
} as const;

export function clerkMessage(error: { message?: string; longMessage?: string | null } | null | undefined): string {
  if (!error) {
    return "";
  }
  return (error.longMessage || error.message || "").trim();
}

type Step = "email" | "reset" | "secondFactor" | "success";
type SecondFactorStrategy = "totp" | "email_code" | "phone_code" | "backup_code";

const primaryButton =
  "inline-flex min-h-10 items-center rounded-md bg-action px-3 py-2 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-10 items-center rounded-md px-3 py-2 font-semibold text-action underline hover:text-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

function inputClass(invalid: boolean): string {
  return `mt-2 w-full rounded-md border bg-white px-3 py-3 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 ${
    invalid ? "border-2 border-red-700" : "border-line-strong"
  }`;
}

function secondFactorStrategy(factors: { strategy: string }[] | undefined): SecondFactorStrategy | null {
  const set = new Set((factors ?? []).map((factor) => factor.strategy));
  if (set.has("totp")) {
    return "totp";
  }
  if (set.has("email_code")) {
    return "email_code";
  }
  if (set.has("phone_code")) {
    return "phone_code";
  }
  if (set.has("backup_code")) {
    return "backup_code";
  }
  return null;
}

export function ForgotPasswordForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const returnPath = useReturnPath();
  const afterReset = redirectUrlFrom(returnPath);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skipInitialFocus = useRef(true);
  const ids = {
    email: useId(),
    code: useId(),
    password: useId(),
    confirm: useId(),
    mfa: useId(),
    emailError: useId(),
    codeError: useId(),
    passwordError: useId(),
    confirmError: useId(),
    mfaError: useId(),
  };

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
    password?: string;
    confirm?: string;
    mfa?: string;
  }>({});
  const [errorKey, setErrorKey] = useState(0);

  const busy = fetchStatus === "fetching";

  useEffect(() => {
    if (skipInitialFocus.current) {
      skipInitialFocus.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function showError(message: string, fields: typeof fieldErrors = {}) {
    setStatusMessage("");
    setFormError(message);
    setFieldErrors(fields);
    setErrorKey((key) => key + 1);
  }

  function clerkField(name: "identifier" | "code" | "password"): string {
    return clerkMessage(errors.fields[name]);
  }

  async function sendResetCode(identifier: string): Promise<string | null> {
    const created = await signIn.create({ identifier });
    if (created.error) {
      return clerkMessage(created.error) || clerkField("identifier") || FORGOT_PASSWORD_COPY.couldNotReset;
    }
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) {
      return clerkMessage(sent.error) || FORGOT_PASSWORD_COPY.couldNotReset;
    }
    return null;
  }

  async function onSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = email.trim();
    if (!identifier) {
      showError("", { email: FORGOT_PASSWORD_COPY.enterEmail });
      return;
    }
    setFormError("");
    setFieldErrors({});
    const error = await sendResetCode(identifier);
    if (error) {
      showError(error, clerkField("identifier") ? { email: clerkField("identifier") } : {});
      return;
    }
    setEmail(identifier);
    setStep("reset");
  }

  async function onResend() {
    setFormError("");
    const error = await sendResetCode(email);
    if (error) {
      showError(error);
      return;
    }
    setStatusMessage(FORGOT_PASSWORD_COPY.resent);
    setErrorKey((key) => key + 1);
  }

  async function finishSignIn(): Promise<boolean> {
    if (signIn.status === "needs_second_factor") {
      const strategy = secondFactorStrategy(signIn.supportedSecondFactors);
      if (strategy === "email_code") {
        const sent = await signIn.mfa.sendEmailCode();
        if (sent.error) {
          showError(clerkMessage(sent.error) || FORGOT_PASSWORD_COPY.couldNotReset);
          return false;
        }
      } else if (strategy === "phone_code") {
        const sent = await signIn.mfa.sendPhoneCode();
        if (sent.error) {
          showError(clerkMessage(sent.error) || FORGOT_PASSWORD_COPY.couldNotReset);
          return false;
        }
      } else if (!strategy) {
        showError(FORGOT_PASSWORD_COPY.couldNotReset);
        return false;
      }
      setFormError("");
      setFieldErrors({});
      setMfaCode("");
      setStep("secondFactor");
      return false;
    }
    if (signIn.status !== "complete") {
      showError(FORGOT_PASSWORD_COPY.couldNotReset);
      return false;
    }
    const done = await signIn.finalize();
    if (done.error) {
      showError(clerkMessage(done.error) || FORGOT_PASSWORD_COPY.couldNotReset);
      return false;
    }
    setFormError("");
    setFieldErrors({});
    setStep("success");
    return true;
  }

  async function onSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields: typeof fieldErrors = {};
    if (!code.trim()) {
      fields.code = FORGOT_PASSWORD_COPY.enterCode;
    }
    if (!password) {
      fields.password = FORGOT_PASSWORD_COPY.enterPassword;
    }
    if (password && confirm !== password) {
      fields.confirm = FORGOT_PASSWORD_COPY.mismatch;
    }
    if (Object.keys(fields).length > 0) {
      showError("", fields);
      return;
    }
    setFormError("");
    setFieldErrors({});
    setStatusMessage("");
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (verified.error) {
      showError(clerkMessage(verified.error) || clerkField("code") || FORGOT_PASSWORD_COPY.couldNotReset, {
        ...(clerkField("code") ? { code: clerkField("code") } : {}),
      });
      return;
    }
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({
      password,
      signOutOfOtherSessions: true,
    });
    if (submitted.error) {
      showError(clerkMessage(submitted.error) || clerkField("password") || FORGOT_PASSWORD_COPY.couldNotReset, {
        ...(clerkField("password") ? { password: clerkField("password") } : {}),
      });
      return;
    }
    await finishSignIn();
  }

  async function onVerifySecondFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaCode.trim()) {
      showError("", { mfa: FORGOT_PASSWORD_COPY.enterCode });
      return;
    }
    setFormError("");
    setFieldErrors({});
    const strategy = secondFactorStrategy(signIn.supportedSecondFactors);
    const params = { code: mfaCode.trim() };
    let result: { error: { message?: string; longMessage?: string | null } | null };
    if (strategy === "totp") {
      result = await signIn.mfa.verifyTOTP(params);
    } else if (strategy === "email_code") {
      result = await signIn.mfa.verifyEmailCode(params);
    } else if (strategy === "phone_code") {
      result = await signIn.mfa.verifyPhoneCode(params);
    } else if (strategy === "backup_code") {
      result = await signIn.mfa.verifyBackupCode(params);
    } else {
      showError(FORGOT_PASSWORD_COPY.couldNotReset);
      return;
    }
    if (result.error) {
      showError(clerkMessage(result.error) || clerkField("code") || FORGOT_PASSWORD_COPY.couldNotReset);
      return;
    }
    await finishSignIn();
  }

  const heading =
    step === "reset"
      ? FORGOT_PASSWORD_COPY.sentCode(email)
      : step === "secondFactor"
        ? FORGOT_PASSWORD_COPY.secondFactorTitle
        : step === "success"
          ? FORGOT_PASSWORD_COPY.successTitle
          : FORGOT_PASSWORD_COPY.title;

  const identifierError = fieldErrors.email || clerkField("identifier");
  const codeError = fieldErrors.code;
  const passwordError = fieldErrors.password || clerkField("password");
  const confirmError = fieldErrors.confirm;
  const mfaError = fieldErrors.mfa;
  const alertText = formError;

  return (
    <>
      <header className="border-b border-line pb-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-action">orinks.net</p>
        <h1 className="max-w-4xl text-4xl font-bold text-ink sm:text-5xl" ref={headingRef} tabIndex={-1}>
          {heading}
        </h1>
      </header>
      <section className="py-8">
        {alertText ? (
          <p className="mb-6 text-red-800" key={errorKey} role="alert">
            {alertText}
          </p>
        ) : statusMessage ? (
          <p className="mb-6 text-slate-700" key={errorKey} role="status">
            {statusMessage}
          </p>
        ) : null}

        {step === "email" ? (
          <form className="max-w-md space-y-6" noValidate onSubmit={onSendCode}>
            <Field
              autoComplete="email"
              error={identifierError}
              errorId={ids.emailError}
              id={ids.email}
              label={FORGOT_PASSWORD_COPY.emailLabel}
              name="email"
              onChange={setEmail}
              type="email"
              value={email}
            />
            <div className="flex flex-wrap gap-3">
              <button className={primaryButton} disabled={busy} type="submit">
                {busy ? FORGOT_PASSWORD_COPY.sending : FORGOT_PASSWORD_COPY.sendCode}
              </button>
            </div>
          </form>
        ) : null}

        {step === "reset" ? (
          <form className="max-w-md space-y-6" noValidate onSubmit={onSetPassword}>
            <Field
              autoComplete="one-time-code"
              error={codeError}
              errorId={ids.codeError}
              id={ids.code}
              label={FORGOT_PASSWORD_COPY.codeLabel}
              name="code"
              onChange={setCode}
              value={code}
            />
            <Field
              autoComplete="new-password"
              error={passwordError}
              errorId={ids.passwordError}
              id={ids.password}
              label={FORGOT_PASSWORD_COPY.passwordLabel}
              name="password"
              onChange={setPassword}
              type="password"
              value={password}
            />
            <Field
              autoComplete="new-password"
              error={confirmError}
              errorId={ids.confirmError}
              id={ids.confirm}
              label={FORGOT_PASSWORD_COPY.confirmLabel}
              name="confirm"
              onChange={setConfirm}
              type="password"
              value={confirm}
            />
            <div className="flex flex-wrap gap-3">
              <button className={primaryButton} disabled={busy} type="submit">
                {busy ? FORGOT_PASSWORD_COPY.settingPassword : FORGOT_PASSWORD_COPY.setPassword}
              </button>
              <button className={secondaryButton} disabled={busy} onClick={onResend} type="button">
                {FORGOT_PASSWORD_COPY.resendCode}
              </button>
            </div>
          </form>
        ) : null}

        {step === "secondFactor" ? (
          <form className="max-w-md space-y-6" noValidate onSubmit={onVerifySecondFactor}>
            <Field
              autoComplete="one-time-code"
              error={mfaError}
              errorId={ids.mfaError}
              id={ids.mfa}
              label={FORGOT_PASSWORD_COPY.codeLabel}
              name="mfa-code"
              onChange={setMfaCode}
              value={mfaCode}
            />
            <div className="flex flex-wrap gap-3">
              <button className={primaryButton} disabled={busy} type="submit">
                {busy ? FORGOT_PASSWORD_COPY.verifying : FORGOT_PASSWORD_COPY.verify}
              </button>
            </div>
          </form>
        ) : null}

        {step === "success" ? (
          <div className="max-w-md space-y-6">
            <p className="text-slate-700">{FORGOT_PASSWORD_COPY.successBody}</p>
            <p>
              <Link className={primaryButton} href={afterReset}>
                {FORGOT_PASSWORD_COPY.continue}
              </Link>
            </p>
          </div>
        ) : (
          <p className="mt-8">
            <Link className={secondaryButton} href={signInHref(returnPath)}>
              {FORGOT_PASSWORD_COPY.signIn}
            </Link>
          </p>
        )}
      </section>
    </>
  );
}

function Field({
  autoComplete,
  error,
  errorId,
  id,
  label,
  name,
  onChange,
  type = "text",
  value,
}: {
  autoComplete: string;
  error?: string;
  errorId: string;
  id: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  const invalid = Boolean(error);
  return (
    <div>
      <label className="block font-semibold text-ink" htmlFor={id}>
        {label}
      </label>
      <input
        autoCapitalize="none"
        autoComplete={autoComplete}
        aria-describedby={invalid ? errorId : undefined}
        aria-invalid={invalid}
        className={inputClass(invalid)}
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        type={type}
        value={value}
      />
      {error ? (
        <p className="mt-2 text-red-800" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
