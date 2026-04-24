import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "AccessiClock",
};

export default function AccessiClockPage() {
  return (
    <>
      <PageHeader title="AccessiClock" />
      <Section>
        <p>
          This project is currently in development. Check back soon for more information, downloads,
          and release notes.
        </p>
      </Section>
    </>
  );
}
