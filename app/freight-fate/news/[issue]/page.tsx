import { notFound } from "next/navigation";
import { PaperEditionPage, paperMetadata, parseIssue } from "../paper-route";

export const revalidate = 300;

type Params = { params: Promise<{ issue: string }> };

export async function generateMetadata({ params }: Params) {
  const issue = parseIssue((await params).issue);
  return paperMetadata(issue ?? 0);
}

export default async function FreightFateNewsIssuePage({ params }: Params) {
  const issue = parseIssue((await params).issue);
  if (issue === null) notFound();
  return <PaperEditionPage issue={issue} />;
}
