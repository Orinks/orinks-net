import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AccessiWeather",
};

export default function AccessiWeatherPage() {
  return (
    <>
      <PageHeader
        title="AccessiWeather"
        intro="An accessible desktop weather application designed for screen reader users."
      />
      <Section>
        <p>
          AccessiWeather provides current conditions, forecasts, severe weather alerts, forecast
          discussions, weather history, AI weather explanations, and keyboard-first workflows for
          Windows, macOS, and Linux.
        </p>
        <p>
          <ButtonLink href="/accessiweather/user-manual" variant="secondary">
            Read the user manual
          </ButtonLink>
        </p>
      </Section>
      <ReleaseDownloads productName="AccessiWeather" repo="AccessiWeather" />
      <Section title="Links">
        <ul>
          <li>
            <a href="https://github.com/Orinks/AccessiWeather">GitHub repository</a>
          </li>
          <li>
            <a href="https://github.com/Orinks/AccessiWeather/issues">Report an issue</a>
          </li>
        </ul>
      </Section>
    </>
  );
}
