import type { Metadata } from "next";
import { anyApi } from "convex/server";
import { PageHeader } from "@/components/PageHeader";
import { ProblemReportForm } from "@/components/ProblemReportForm";
import { getConvexClient } from "@/lib/convex";

// The problem report a game opened in the browser: its logs are already with
// the site (convex/problemReports.ts); the player writes what happened here.
type ReportPageProps = { params: Promise<{ code: string }> };

type Draft = {
  app: string;
  version: string;
  crashed: boolean;
  logs: { name: string; bytes: number }[];
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Report a problem",
  robots: { index: false, follow: false },
};

async function draftFor(code: string): Promise<Draft | null> {
  if (!/^[0-9a-f]{40}$/.test(code)) return null;
  const client = getConvexClient();
  if (!client) return null;
  try {
    return (await client.query(anyApi.problemReports.peek, { code })) as Draft | null;
  } catch {
    return null;
  }
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { code } = await params;
  const draft = await draftFor(code);

  if (!draft) {
    return (
      <>
        <PageHeader title="Report a problem" />
        <section className="py-8">
          <p className="max-w-2xl text-slate-700">
            This link has expired or was already used. Open Report a problem in the game again, or{" "}
            <a className="font-semibold text-action underline hover:no-underline" href="/contact">
              write through the contact form
            </a>
            .
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Report a problem with ${draft.app}`} />
      {/* Not wrapped in <Section>: its `prose` styles would fight the form's
          own spacing and label typography. */}
      <section className="py-8">
        <ProblemReportForm app={draft.app} code={code} crashed={draft.crashed} logs={draft.logs} version={draft.version} />
      </section>
    </>
  );
}
