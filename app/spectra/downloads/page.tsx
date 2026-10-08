import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Spectra Downloads",
};

export default function SpectraDownloadsPage() {
  return (
    <>
      <PageHeader title="Spectra Downloads" />
      <Section>
        <p>Extract the ZIP and run Spectra.exe from the extracted folder. Nothing is installed.</p>
        <p>
          <a href="/spectra">Back to Spectra</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Spectra" repo="Spectra" />
    </>
  );
}
