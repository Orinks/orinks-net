import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AccessiWeather Downloads",
};

export default function AccessiWeatherDownloadsPage() {
  return (
    <>
      <PageHeader
        title="AccessiWeather Downloads"
        intro="Stable releases and nightly builds for AccessiWeather."
      />
      <Section>
        <p>
          Use the stable release for the most dependable build, or choose a nightly when you want
          the newest fixes and are comfortable with development snapshots.
        </p>
        <p>
          <a href="/accessiweather">Back to AccessiWeather</a>
        </p>
      </Section>
      <ReleaseDownloads productName="AccessiWeather" repo="AccessiWeather" />
    </>
  );
}
