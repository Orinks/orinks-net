import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Saltwake Downloads",
};

export default function SaltwakeDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Saltwake Downloads"
        intro="Stable releases and developer snapshots for Saltwake."
      />
      <Section>
        <p>
          Use the stable release for everyday tides, or choose a developer snapshot when you want
          the newest features and fixes before they reach a stable release. Both are portable
          builds for Windows, macOS, and Linux: unzip and run, no installer required.
        </p>
        <p>
          <a href="/saltwake">Back to Saltwake</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Saltwake" repo="saltwake" />
    </>
  );
}
