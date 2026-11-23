import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { clerkAccountAppearance } from "@/lib/clerk-account-appearance";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/account-hrefs";

export const metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  return (
    <>
      <PageHeader title="Create account" />
      <section className="py-8">
        <Suspense fallback={<p className="text-slate-700">Loading…</p>}>
          <SignUp appearance={clerkAccountAppearance} path={SIGN_UP_PATH} routing="path" signInUrl={SIGN_IN_PATH} />
        </Suspense>
      </section>
    </>
  );
}
