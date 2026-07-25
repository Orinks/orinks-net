import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AccessiWeather Downloads",
};

export default function AccessiWeatherDownloadsPage() {
  return (
    <>
      <PageHeader
        title="AccessiWeather Downloads"
        intro="Stable releases and nightly builds for AccessiWeather."
      />
      <Section>
        <p>
          Use the stable release for the most dependable build, or choose a nightly when you want
          the newest fixes and are comfortable with development snapshots.
        </p>
        <p>
          On Linux, choose the <strong>Linux AppImage</strong> download. It runs on any modern
          distribution, including Fedora, Ubuntu, Arch, and openSUSE. Mark the file executable,
          then run it. AccessiWeather updates itself in place from inside the AppImage. It
          downloads the new version, verifies it, and restarts on its own.
        </p>
        <p>
          The Linux tarball remains available for Ubuntu and Debian systems. Tarball updates
          download and verify themselves, then tell you where the file was saved so you can
          install it.
        </p>
        <p>
          <a href="/accessiweather">Back to AccessiWeather</a>
        </p>
      </Section>
      <ReleaseDownloads productName="AccessiWeather" repo="AccessiWeather" />
    </>
  );
}
