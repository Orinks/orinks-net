import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Freight Fate: Dispatch Downloads",
};

export default function FreightFateDispatchDownloadsPage() {
  return (
    <>
      <PageHeader title="Freight Fate: Dispatch Downloads" />
      <Section>
        <p>
          Every build is portable: unzip it and run FreightFateDispatch, no installer. On a Mac,
          the first time, Control-click the app and choose Open, because the test builds are not
          notarized yet.
        </p>
        <p>
          <a href="/freight-fate-dispatch">Back to Freight Fate: Dispatch</a>
        </p>
      </Section>
      <ReleaseDownloads
        productName="Freight Fate: Dispatch"
        repo="freight-fate-dispatch"
        prereleaseLabel="test builds"
      />
    </>
  );
}
