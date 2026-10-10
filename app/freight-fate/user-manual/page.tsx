import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { renderMarkdown } from "@/lib/github";
import { addManualHeadingIds } from "@/lib/manual-headings";

export const metadata = {
  title: "Freight Fate Player Manual",
};

const MANUAL_SOURCE_URL =
  "https://raw.githubusercontent.com/orinks-games/Freight-Fate/main/docs/user-manual.md";
const MANUAL_GITHUB_URL =
  "https://github.com/orinks-games/Freight-Fate/blob/main/docs/user-manual.md";

export default async function UserManualPage() {
  const manualMarkdown = await getManualMarkdown();
  const body = stripTitle(manualMarkdown);
  const rendered = await renderMarkdown(body, "Freight-Fate");
  const manualHtml = rendered && body ? addManualHeadingIds(rendered, body) : null;

  return (
    <>
      <PageHeader
        title="Freight Fate Player Manual"
        intro="How to play, from your first delivery to traffic, radio, settings, and career choices."
      />
      <div className="my-6 flex flex-wrap gap-4">
        <ButtonLink href={MANUAL_GITHUB_URL} variant="secondary">
          Open the Freight Fate player manual on GitHub
        </ButtonLink>
      </div>
      <Section>
        {manualHtml ? (
          <div dangerouslySetInnerHTML={{ __html: manualHtml }} />
        ) : (
          <p>
            The manual could not be loaded here right now. Use the link above to open it on GitHub.
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
