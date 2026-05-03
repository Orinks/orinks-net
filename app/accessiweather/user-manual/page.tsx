import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "AccessiWeather User Manual",
};

const manualSections = [
  {
    title: "Introduction",
    body: [
      "AccessiWeather is an accessible desktop weather application for Windows, macOS, and Linux. It is designed to work well with screen readers, keyboard navigation, desktop notifications, and clear text layouts.",
      "The app separates weather into practical sections: Location selector, Current Conditions, Hourly Forecast, Daily Forecast, Weather Alerts, and Event Center.",
    ],
  },
  {
    title: "Installing and starting AccessiWeather",
    body: [
      "Prebuilt downloads are available from the AccessiWeather page and the GitHub releases page. Typical download options are Windows setup installer, Windows portable ZIP, and macOS ZIP.",
      "When you start AccessiWeather for the first time, an onboarding wizard can help add a location and optional provider keys.",
    ],
  },
  {
    title: "Everyday tasks",
    body: [
      "Use Location > Add Location or Ctrl+L to add a location. Use F5 or Ctrl+R to refresh weather. Use Location > Remove Location or Ctrl+D to remove the current location.",
      "Forecast Discussion opens local National Weather Service discussion products for supported US locations. Weather Alerts lists active hazards for the selected place.",
    ],
  },
  {
    title: "Weather sources and automatic mode",
    body: [
      "Automatic mode chooses from supported providers and can merge results. NWS is best for US forecasts, alerts, and discussions. Open-Meteo provides broad global forecast coverage. Pirate Weather and Visual Crossing can add global data when configured with API keys.",
      "Automatic mode supports Max coverage, Economy, and Balanced API budgets, with separate source order lists for US and international locations.",
    ],
  },
  {
    title: "Alerts and notifications",
    body: [
      "Alerts are hazards received from a weather source. Notifications are desktop popups or optional sounds sent when something changes.",
      "For US locations, NWS alerts are authoritative in Automatic mode. For international locations, Pirate Weather is preferred when available, with Visual Crossing as fallback.",
    ],
  },
  {
    title: "Keyboard shortcuts",
    body: [
      "F5 or Ctrl+R refreshes weather. Ctrl+L adds a location. Ctrl+D removes a location. Ctrl+S opens Settings. Ctrl+H opens Weather History. Ctrl+E opens Explain Weather. Ctrl+T opens Weather Assistant. Ctrl+Shift+R opens NOAA Weather Radio. Ctrl+Q quits.",
    ],
  },
  {
    title: "Where to get help",
    body: [
      "Use the AccessiWeather page on orinks.net for downloads, GitHub issues for bug reports, and GitHub releases for direct release access.",
    ],
  },
];

export default function UserManualPage() {
  return (
    <>
      <PageHeader
        title="AccessiWeather User Manual"
        intro="A condensed web manual for installing, navigating, configuring, and troubleshooting AccessiWeather."
      />
      <nav aria-label="Table of contents" className="my-8 rounded-lg border border-line bg-white p-5">
        <h2 className="text-xl font-bold text-ink">Contents</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          {manualSections.map((section) => (
            <li key={section.title}>
              <a className="font-semibold text-action hover:text-action-dark" href={`#${slug(section.title)}`}>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {manualSections.map((section) => (
        <Section key={section.title} title={section.title}>
          <div id={slug(section.title)}>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
