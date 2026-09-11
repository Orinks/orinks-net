import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { renderMarkdown } from "@/lib/github";

export const metadata = {
  title: "Freight Fate Career 1.9 User Manual",
};

const MANUAL_SOURCE_URL =
  "https://raw.githubusercontent.com/Orinks/Freight-Fate/feat/career-1.9/docs/user-manual.md";
const MANUAL_GITHUB_URL =
  "https://github.com/Orinks/Freight-Fate/blob/feat/career-1.9/docs/user-manual.md";

export default async function UserManualPage() {
  const manualMarkdown = await getManualMarkdown();
  const manualHtml = await renderMarkdown(stripTitle(manualMarkdown), "Freight-Fate");

  return (
    <>
      <PageHeader
        title="Freight Fate Career 1.9 User Manual"
        intro="This manual covers installation, driving, careers, accessibility, and troubleshooting for Career 1.9 tester builds. If you use an older release, follow the manual included with that build."
      />
      <div className="my-6 flex flex-wrap gap-4">
        <ButtonLink href={MANUAL_GITHUB_URL} variant="secondary">
          Open the Freight Fate Career 1.9 manual on GitHub
        </ButtonLink>
      </div>
      <Section>
        {manualHtml ? (
          <div dangerouslySetInnerHTML={{ __html: manualHtml }} />
        ) : (
          <p>
            The manual could not be loaded here right now. Use the Freight Fate Career 1.9 manual link above to open the
            Career 1.9 user manual.
          </p>
        )}
      </Section>
    </>
  );
}

async function getManualMarkdown() {
  const response = await fetch(MANUAL_SOURCE_URL, {
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

function stripTitle(markdown: string | null) {
  return markdown?.replace(/^# Freight Fate Player Manual\s*/u, "") ?? null;
}
