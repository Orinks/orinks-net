import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { renderMarkdown } from "@/lib/github";

export const metadata = {
  title: "AccessiWeather User Manual",
};

const MANUAL_SOURCE_URL =
  "https://raw.githubusercontent.com/Orinks/AccessiWeather/dev/docs/user_manual.md";
const MANUAL_GITHUB_URL = "https://github.com/Orinks/AccessiWeather/blob/dev/docs/user_manual.md";

export default async function UserManualPage() {
  const manualMarkdown = await getManualMarkdown();
  const manualHtml = await renderMarkdown(stripTitle(manualMarkdown), "AccessiWeather");

  return (
    <>
      <PageHeader
        title="AccessiWeather User Manual"
        intro="The full AccessiWeather manual for installing, navigating, configuring, and troubleshooting the app."
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
            current AccessiWeather user manual.
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
  return markdown?.replace(/^# AccessiWeather User Manual\s*/u, "") ?? null;
}
