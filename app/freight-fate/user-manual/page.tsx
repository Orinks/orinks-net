import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { renderMarkdown } from "@/lib/github";

export const metadata = {
  title: "Freight Fate User Manual",
};

const MANUAL_SOURCE_URL =
  "https://raw.githubusercontent.com/Orinks/Freight-Fate/dev/docs/user-manual.md";
const MANUAL_GITHUB_URL =
  "https://github.com/Orinks/Freight-Fate/blob/dev/docs/user-manual.md";

export default async function UserManualPage() {
  const manualMarkdown = await getManualMarkdown();
  const manualHtml = await renderMarkdown(stripTitle(manualMarkdown), "Freight-Fate");

  return (
    <>
      <PageHeader
        title="Freight Fate User Manual"
        intro="The full Freight Fate manual for installing, driving, managing a career, using accessibility features, and troubleshooting."
      />
      <div className="my-6">
        <ButtonLink href={MANUAL_GITHUB_URL} variant="secondary">
          Open this manual on GitHub
        </ButtonLink>
      </div>
      <Section>
        {manualHtml ? (
          <div dangerouslySetInnerHTML={{ __html: manualHtml }} />
        ) : (
          <p>
            The manual could not be loaded here right now. Use the GitHub link above to open the
            current Freight Fate user manual.
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
