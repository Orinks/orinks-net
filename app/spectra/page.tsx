import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Spectra",
};

export default function SpectraPage() {
  return (
    <>
      <PageHeader
        title="Spectra"
        intro="A screen-reader-first OpenAPI documentation browser and REST client."
      />
      <Section>
        <p>
          This project is currently in development. Check back soon for more information, downloads,
          and release notes.
        </p>
      </Section>
    </>
  );
}
