import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import type { ProjectPage } from "@/lib/site";

type FreightFateLandingProps = {
  project: ProjectPage;
};

/** The top of the page: the title, the pitch in one line, and the downloads.
 *
 * The live sections (drivers on duty, driver updates) follow this on the
 * page, and the features in FreightFatePitch come after them, so a returning
 * player reaches the downloads and the road without reading the pitch again.
 */
export function FreightFateIntro({ project }: FreightFateLandingProps) {
  return (
    <>
      <PageHeader title={project.title} intro={project.summary} showSiteName={false} />
      <div className="flex flex-wrap gap-3 pt-8">
        <ButtonLink href="/freight-fate/downloads">Downloads</ButtonLink>
        <ButtonLink href="/freight-fate/user-manual" variant="secondary">
          Player manual
        </ButtonLink>
      </div>
      <Section>
        <p>Free for Windows, Apple Silicon Macs, and Linux on x64 or ARM64.</p>
      </Section>
    </>
  );
}

/** The features, then the community and source links to close the page. */
export function FreightFatePitch({ project }: FreightFateLandingProps) {
  return (
    <>
      <Section title="Driving and freight">
        <p>Drive a ten-speed manual with a clutch or an automatic, use the engine brake on descents, and haul freight on mapped lanes, ramps, and city streets between more than 600 cities. Pick up at ports, rail ramps, farms, and plants; speed limits follow state laws, and National Weather Service reports and state road-work information are available on the route.</p>
        <p>The GPS warns about bends, grades, and lower speed limits ahead. Driving assists can keep you in your lane, take bends and exits, and stop at the dock, and you can adjust each one.</p>
      </Section>

      <Section title="Career and radio">
        <p>Start with a company truck or as an owner-operator, unlock freight endorsements, plan around legal hours, and manage inspections, carrier records, and insurance.</p>
        <p>Thousands of real radio stations come into range and fade as you travel. The game also has its own stations with original songs, and you can play a personal playlist or music the game composes as you drive.</p>
        <p>Menus and driving information support NVDA, JAWS, VoiceOver, Orca, and Speech Dispatcher on Linux; NVDA and JAWS support braille displays, and the game supports keyboard and controller input.</p>
      </Section>

      <Section title="Community and source">
        <ul>
          {project.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
