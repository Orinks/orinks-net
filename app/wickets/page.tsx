import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Wicket's",
  description: "A collection of audio games for blind and visually impaired players: action games, puzzles, relaxing activities, and table games for Windows, macOS, and Linux.",
};

export default function WicketsPage() {
  return (
    <>
      <PageHeader
        title="Wicket's"
        intro="A collection of audio games for blind and visually impaired players: action games, puzzles, relaxing activities, and table games for Windows, macOS, and Linux."
      />
      <Section>
        <p>
          Wicket&apos;s is a collection of games that includes Lantern Lake, where you paddle to
          chiming lanterns; Neon Rail: Black Sky Run, a three-lane skimmer chase; Belfry, a
          bell-sequence puzzle; and Rooftop Garden, where you tend plants that play together.
        </p>
        <p>
          Its optional parlor story follows a new keeper reopening a parlor that has been dark
          for twelve years. Play the suggested games to light the Long Hall and meet its regulars,
          or choose games directly from Play.
        </p>
        <p>
          Daily, weekly, and monthly challenges add new goals to familiar games, while seasonal
          games add activities for holidays and special dates.
        </p>
        <p>Wicket&apos;s is free for Windows, macOS on Apple Silicon, and Linux.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/wickets/downloads">Download Wicket&apos;s</ButtonLink>
        </div>
        <div className="mt-4">
          <a href="https://github.com/orinks-games/wickets/releases">Wicket&apos;s releases on GitHub</a>
        </div>
        <p className="mt-6">Made by Orinks, with the assistance of an agentic coder; sound synthesis uses genny and Klang.</p>
      </Section>
    </>
  );
}
