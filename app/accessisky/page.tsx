import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "AccessiSky",
};

export default function AccessiSkyPage() {
  return (
    <>
      <PageHeader
        title="AccessiSky"
        intro="AccessiSky is no longer being actively maintained."
      />
      <Section>
        <p>
          AccessiSky remains available as an archived project, but it is no longer a current Orinks
          project and should not be treated as maintained software.
        </p>
        <p>
          Existing downloads and release notes remain on GitHub for people who still need the old
          v0.2.0 pre-release.
        </p>
        <ul>
          <li>
            <a href="https://github.com/Orinks/AccessiSky">Archived GitHub repository</a>
          </li>
          <li>
            <a href="https://github.com/Orinks/AccessiSky/releases/tag/v0.2.0">
              AccessiSky v0.2.0 release
            </a>
          </li>
        </ul>
      </Section>
    </>
  );
}
