import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wicket's Downloads",
};

export default function WicketsDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Wicket's Downloads"
        intro="Releases of Wicket&apos;s for Windows, macOS and Linux."
      />
      <Section>
        <p>
          Every build is portable: unzip it and run Wicket&apos;s, no installer
          required. Your settings and saves stay in a saves folder beside the
          game. To update, unzip the new version over the old one.
        </p>
        <p>
          The macOS build runs on Apple Silicon Macs. On Linux, unpack the
          tarball and run the wickets program inside.
        </p>
        <p>
          <a href="/wickets">Back to Wicket&apos;s</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Wicket's" repo="wickets" />
    </>
  );
}
