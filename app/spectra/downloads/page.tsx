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
      <Section title="Install from source">
        <p>Spectra runs from source and needs Python 3.11 or later.</p>
        <ol>
          <li>
            Open the release with the &ldquo;View release assets on GitHub&rdquo; link below, then
            choose &ldquo;Source code (zip)&rdquo; and extract it.
          </li>
          <li>
            In the extracted folder, run <code>pip install -e .</code> The command ends with a
            space and a period.
          </li>
          <li>
            Start Spectra with <code>spectra</code>.
          </li>
        </ol>
        <p>
          <a href="/spectra">Back to Spectra</a>
        </p>
      </Section>
      <ReleaseDownloads productName="Spectra" repo="Spectra" />
    </>
  );
}
