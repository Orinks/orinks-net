import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "AccessiSky",
};

export default function AccessiSkyPage() {
  return (
    <>
      <PageHeader
        title="AccessiSky"
        intro="An accessible sky and astronomy tool for Windows, designed for screen reader users."
      />
      <Section>
        <h2>AccessiSky v0.2.0 pre-release</h2>
        <p>
          AccessiSky v0.2.0 added location search, tonight&apos;s summary, daily briefing data,
          meteor shower calendars, planet visibility, eclipse calendars, dark sky times, viewing
          condition scoring, weather integration, and USNO moon data.
        </p>
        <h3>Highlights</h3>
        <ul>
          <li>Search for cities by name using the Open-Meteo geocoding API.</li>
          <li>Read a plain-language overview of tonight&apos;s sky conditions.</li>
          <li>Review sunrise, sunset, moon phase, ISS passes, visible planets, and space weather.</li>
          <li>Track 11 major annual meteor showers and all 7 observable planets.</li>
          <li>Use accessible text summaries designed for screen reader workflows.</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="https://github.com/Orinks/AccessiSky/releases/download/v0.2.0/AccessiSky_Portable_v0.2.0_Windows.zip">
            Download Windows portable
          </ButtonLink>
          <ButtonLink
            href="https://github.com/Orinks/AccessiSky/releases/download/v0.2.0/AccessiSky_v0.2.0_macOS.zip"
            variant="secondary"
          >
            Download macOS build
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
