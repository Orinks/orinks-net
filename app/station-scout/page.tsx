import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Station Scout",
};

export default function StationScoutPage() {
  return (
    <>
      <PageHeader
        title="Station Scout"
        intro="An accessible desktop internet radio explorer for Windows, macOS, and Linux."
      />
      <Section>
        <p>
          Station Scout is built for browsing and playing internet radio stations with screen
          reader-friendly controls, keyboard-first search, favorite stations, direct stream
          playback, and Radio Browser discovery.
        </p>
      </Section>
      <ReleaseDownloads productName="Station Scout" repo="station-scout" />
      <Section title="Links">
        <ul>
          <li>
            <a href="https://github.com/Orinks/station-scout">GitHub repository</a>
          </li>
          <li>
            <a href="https://github.com/Orinks/station-scout/issues">Report an issue</a>
          </li>
        </ul>
      </Section>
    </>
  );
}
