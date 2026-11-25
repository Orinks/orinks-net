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
        <ul className="mb-6 max-w-2xl list-disc space-y-1 pl-5 text-slate-700">
          <li>Usernames are shared across orinks.net. You pick your player name in each game later.</li>
          <li>Passwords that have shown up in a data leak on any site can&apos;t be used, so choose a new one.</li>
          <li>With Google or Apple, you still choose your own username.</li>
        </ul>
        <Suspense fallback={loading}>
          <SignUp fallback={loading} path={SIGN_UP_PATH} routing="path" signInUrl={SIGN_IN_PATH} />
        </Suspense>
      </section>
    </>
  );
}
