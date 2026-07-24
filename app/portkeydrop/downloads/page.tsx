import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PortkeyDrop Downloads",
};

export default function PortkeyDropDownloadsPage() {
  return (
    <>
      <PageHeader
        title="PortkeyDrop Downloads"
        intro="Stable releases and nightly builds for PortkeyDrop."
      />
      <Section>
        <p>
          Use the stable release for regular file transfers, or choose a nightly build when you want
          the newest transfer and accessibility fixes.
        </p>
        <p>
          On Linux, choose the <strong>Linux AppImage</strong> download. It runs on any modern
          distribution, including Fedora, Ubuntu, Arch, and openSUSE. Mark the file executable,
          then run it. The Linux tarball remains available for Ubuntu and Debian systems.
        </p>
        <p>
          <a href="/portkeydrop">Back to PortkeyDrop</a>
        </p>
      </Section>
      <ReleaseDownloads productName="PortkeyDrop" repo="PortkeyDrop" />
    </>
  );
}
