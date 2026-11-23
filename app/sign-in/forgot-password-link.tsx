"use client";

import Link from "next/link";
import { forgotPasswordHref } from "@/lib/account-hrefs";
import { useReturnPath } from "@/lib/use-return-path";

export function SignInForgotPasswordLink() {
  const returnPath = useReturnPath();

  return (
    <p className="mb-6">
      <Link
        className="font-semibold text-action underline hover:text-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600"
        href={forgotPasswordHref(returnPath)}
      >
        Forgot password?
      </Link>
    </p>
  );
}
