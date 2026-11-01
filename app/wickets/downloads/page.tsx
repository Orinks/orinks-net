import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wicket's Downloads",
  description: "Download Wicket's for Windows, macOS on Apple Silicon, or Linux, with instructions for keeping your saves when updating.",
};

export default function WicketsDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Wicket's Downloads"
        intro="Releases of Wicket's for Windows, macOS and Linux."
      />
      <Section>
        <p>
          Download the package for your system and unpack it. No installer is required.
        </p>
        <ul>
          <li><strong>Windows:</strong> Unzip the download and run Wicket&apos;s.</li>
          <li><strong>macOS:</strong> The build runs on Apple Silicon Macs. Unzip the download
            and open Wicket&apos;s.app.</li>
          <li><strong>Linux:</strong> Unpack the tarball and run the wickets program inside.</li>
        </ul>
      </Section>
      <Section title="Updating and keeping your saves">
        <p>
          On Windows and Linux, settings and saves stay in the <code>saves</code> folder beside
          the game. Unpack the new version over the old copy, or move the old <code>saves</code>
          {" "}folder into the new copy before starting it.
        </p>
        <p>
          On macOS, replace the app. Your settings and saves stay in
          {" "}<code>~/Library/Application Support/Wickets</code>.
        </p>
        <p><a href="/wickets">About Wicket&apos;s and its games</a></p>
      </Section>
      <ReleaseDownloads productName="Wicket's" repo="wickets" />
    </>
  );
}
