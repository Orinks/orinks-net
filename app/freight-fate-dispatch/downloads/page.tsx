import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

// Rebuilt at most every five minutes rather than on every visit. Dispatch's
// release workflow does not announce builds to the site, so this interval is
// what brings a new release onto the page.
export const revalidate = 300;

export const metadata = {
  title: "Freight Fate: Dispatch Downloads",
  description: "Download Freight Fate: Dispatch for Windows, macOS on Apple Silicon, or Linux.",
};

export default function FreightFateDispatchDownloadsPage() {
  return (
    <>
      <PageHeader title="Freight Fate: Dispatch Downloads" />
      <Section>
        <p>
          On Windows, unzip the game somewhere other than Program Files. It keeps your careers
          in its own folder, and Windows won&apos;t let it write there.
        </p>
      </Section>
      <ReleaseDownloads
        productName="Freight Fate: Dispatch"
        repo="freight-fate-dispatch"
        prereleaseLabel="beta releases"
        buildNotifications={false}
        heading={false}
      />
    </>
  );
}
