import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import type { ProjectPage } from "@/lib/site";

type Feature = {
  title: string;
  body: string;
  points?: string[];
};

// Flat h2s on purpose: each one is a stop in a screen reader's heading list,
// following on from the drivers board and updates above them.
const features: Feature[] = [
  {
    title: "Hear the road",
    body: "Listen to the engine for steering guidance and the road noise for your position in the lane. The GPS warns you about bends, grades, and lower speed limits ahead, giving you time to slow down before a curve or exit ramp.",
    points: [
      "Drive a ten-speed manual with a clutch or use an automatic. A three-stage engine brake helps on descents.",
      "Follow mapped lane counts, ramp lengths, and city streets to the dock.",
      "Take bends carefully: cargo can shift, and liquid loads slosh in a tanker.",
    ],
  },
  {
    title: "Drive across America",
    body: "Haul freight between more than 600 cities, with pickups at ports, rail ramps, farms, and plants. Truck speed limits follow state laws. You can use live National Weather Service reports and road work reported by the states.",
    points: [
      "Stop for a meal, shower, or repair, and earn loyalty points at truck stops.",
      "Check your weight at CAT scales, pull into weigh stations, and follow chain laws on western grades.",
      "Hear thousands of roadside billboards, state welcome signs, and real attractions along the way.",
    ],
  },
  {
    title: "Build a career",
    body: "Start with a company truck or pay the bills as an owner-operator. Endorsements open new freight on the dispatch board. Plan rest around your legal hours; troopers and inspectors can stop you, and your record affects your carrier and insurance.",
  },
  {
    title: "Driving assists",
    body: "Choose how much of the drive you want to handle yourself. Assistance can keep you in your lane, guide you through bends and exits, and stop at the dock. Adjust each assist as you learn.",
  },
  {
    title: "Tune in across the country",
    body: "Tune into thousands of real radio stations that come into range and fade as you travel. Freight Fate also has its own stations with original songs. Bring a personal playlist or listen to music the game composes as you drive.",
  },
  {
    title: "Made for screen readers",
    body: "Menus and driving information work with NVDA, JAWS, VoiceOver, Orca, and Speech Dispatcher on Linux. Spoken messages also appear as text. Use a keyboard or controller and reassign supported driving controls. NVDA and JAWS can send messages to a braille display. Learn game sounds lets you hear each cue and its explanation before driving.",
  },
];

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
      {features.map((feature) => (
        <Section key={feature.title} title={feature.title}>
          <p>{feature.body}</p>
          {feature.points ? (
            <ul>
              {feature.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      ))}

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
