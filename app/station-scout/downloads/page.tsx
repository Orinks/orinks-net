import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

// Rebuilt at most every five minutes rather than on every visit. A published
// release purges the release data it reads (app/api/notifications/send), so a
// new build still shows up straight away; the interval only bounds anything
// that skipped that notification.
export const revalidate = 300;

export const metadata = {
  title: "Station Scout Downloads",
};

export default function StationScoutDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Station Scout Downloads"
        intro="Station Scout v1.0.0 builds for Windows, macOS, and Linux."
      />
      <Section>
        <p>
          Download the Windows installer for the simplest setup, use the portable ZIP when you want
          a folder-based Windows build, or choose the macOS and Linux archives for those platforms.
        </p>
        <p>
          <a href="/station-scout">Back to Station Scout</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Station Scout" repo="station-scout" />
    </>
  );
}
