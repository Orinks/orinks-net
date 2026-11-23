import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { clerkAccountAppearance } from "@/lib/clerk-account-appearance";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/account-hrefs";

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <>
      <PageHeader title="Sign in" />
      <section className="py-8">
        <Suspense fallback={<p className="text-slate-700">Loading…</p>}>
          <SignIn appearance={clerkAccountAppearance} path={SIGN_IN_PATH} routing="path" signUpUrl={SIGN_UP_PATH} />
        </Suspense>
      </section>
    </>
  );
}
