import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Freight Fate Downloads",
};

export default function FreightFateDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Freight Fate Downloads"
        intro="Stable releases and preview snapshots for Freight Fate."
      />
      <Section>
        <p>
          Use the stable release for everyday hauling, or choose a preview snapshot when you want
          the newest features and fixes before they reach a stable release. Both are portable
          builds for Windows, macOS, and Linux: unzip and run, no installer required.
        </p>
        <p>
          <a href="/freight-fate">Back to Freight Fate</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Freight Fate" repo="Freight-Fate" />
    </>
  );
}
