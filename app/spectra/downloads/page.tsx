import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

// Rebuilt at most every five minutes rather than on every visit. A published
// release purges the release data it reads (app/api/notifications/send), so a
// new build still shows up straight away; the interval only bounds anything
// that skipped that notification.
export const revalidate = 300;

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
