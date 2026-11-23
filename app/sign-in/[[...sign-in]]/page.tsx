import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/account-hrefs";
import { SignInForgotPasswordLink } from "../forgot-password-link";

export const metadata = {
  title: "Sign in",
};

// Shown by Clerk until its form script has loaded; the Suspense fallback
// alone never appears, because SignIn does not suspend.
const loading = <p className="text-slate-700">Loading the sign-in form…</p>;

export default function SignInPage() {
  return (
    <>
      <PageHeader title="Sign in" />
      <section className="py-8">
        <SignInForgotPasswordLink />
        <Suspense fallback={loading}>
          <SignIn fallback={loading} path={SIGN_IN_PATH} routing="path" signUpUrl={SIGN_UP_PATH} />
        </Suspense>
      </section>
    </>
  );
}
