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
// and the list runs on into the drivers board and updates below.
const features: Feature[] = [
  {
    title: "Drive by ear",
    body: "The engine sound pans toward the side you need to steer, the road noise tells you where you sit in your lane, and a co-driver calls bends, grades and speed-limit drops before you reach them. Take your exit, slow down the ramp, and listen for a gap in the cross traffic at the light.",
    points: [
      "Ten gears, manual with a clutch or automatic, and a three-stage engine brake",
      "Real lane counts, exit ramps at their real lengths, and city streets to the dock",
      "Loads that shift in a fast bend, and tankers that slosh",
    ],
  },
  {
    title: "Cross a real America",
    body: "More than 600 cities, each with its own ports, rail ramps, farms and plants to load at. Speed limits follow each state's truck law, the weather can come live from the National Weather Service, and road work comes from real state reports.",
    points: [
      "Truck stops with meals, showers, repairs and loyalty points",
      "Weigh stations, CAT scales, and chain laws on the western grades",
      "Thousands of roadside billboards, state welcome signs and real roadside attractions",
    ],
  },
  {
    title: "Build a career",
    body: "Start as a company driver or buy in as an owner-operator. Earn your endorsements, take loads from the dispatch board, and keep your hours legal. Troopers and inspectors are on the road, and your driving record follows you to the carrier and the insurer.",
  },
  {
    title: "Choose how much the truck does",
    body: "The first time you start, pick All assists, Balanced or Realistic. The assists can hold your lane, take bends and exits, and stop you at the dock, or they can leave every pedal and turn to you. Change any of them later under Driving assistance.",
  },
  {
    title: "Tune in across the country",
    body: "Thousands of real radio stations come in and fade out as you drive, next to Freight Fate's own stations of original songs. Play your own music from a playlist, or switch to music the game composes as you go.",
  },
  {
    title: "Made for screen readers",
    body: "Every screen speaks through your screen reader, including NVDA, JAWS, VoiceOver and Orca, with Speech Dispatcher on Linux, and every spoken line also appears as text. Play from the keyboard or a controller, move any driving control to another key, follow along on a braille display, and learn every sound in the game before you meet it on the road.",
  },
];

type FreightFateLandingProps = {
  project: ProjectPage;
};

export function FreightFateLanding({ project }: FreightFateLandingProps) {
  return (
    <>
      <PageHeader title={project.title} intro={project.summary} showSiteName={false} />
      <div className="flex flex-wrap gap-3 pt-8">
          <ButtonLink href="/freight-fate/downloads">Download Freight Fate 1.9</ButtonLink>
          <ButtonLink href="/freight-fate/user-manual" variant="secondary">
            User manual
          </ButtonLink>
      </div>
      <Section>
        <p>Free for Windows, Apple Silicon Macs, and Linux on x64 or ARM64.</p>
        <p>
          <strong>Coming from 1.8?</strong> Careers from earlier versions don&apos;t carry over, so
          you&apos;ll start a new one. Your settings come across, and your old saves stay as they were.
        </p>
      </Section>

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
