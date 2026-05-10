import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "AccessiSky Downloads",
};

export default function AccessiSkyDownloadsPage() {
  return (
    <>
      <PageHeader
        title="AccessiSky Downloads"
        intro="AccessiSky is no longer being actively maintained."
      />
      <Section>
        <p>
          AccessiSky downloads are kept as archival links only. The project is no longer a current
          Orinks project and is not being actively maintained.
        </p>
        <ul>
          <li>
            <a href="https://github.com/Orinks/AccessiSky/releases/tag/v0.2.0">
              AccessiSky v0.2.0 release
            </a>
          </li>
          <li>
            <a href="https://github.com/Orinks/AccessiSky">Archived GitHub repository</a>
          </li>
        </ul>
        <p>
          <a href="/accessisky">Back to AccessiSky</a>
        </p>
      </Section>
    </>
  );
}
