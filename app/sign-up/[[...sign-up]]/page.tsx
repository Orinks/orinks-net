import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/account-hrefs";

export const metadata = {
  title: "Create account",
};

// Shown by Clerk until its form script has loaded; the Suspense fallback
// alone never appears, because SignUp does not suspend.
const loading = <p className="text-slate-700">Loading the create account form…</p>;

export default function SignUpPage() {
  return (
    <>
      <PageHeader title="Create account" />
      <section className="py-8">
        <Suspense fallback={loading}>
          <SignUp fallback={loading} path={SIGN_UP_PATH} routing="path" signInUrl={SIGN_IN_PATH} />
        </Suspense>
      </section>
    </>
  );
}
