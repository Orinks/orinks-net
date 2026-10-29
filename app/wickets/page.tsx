import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Wicket's",
};

export default function WicketsPage() {
  return (
    <>
      <PageHeader title="Wicket's" intro="Light a lamp. Pick a game. Stay a while." />
      <Section>
        <p>
          Welcome to Wicket&apos;s. Step into a parlor where every game is built for blind and
          visually impaired players.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/wickets/downloads">Download Wicket&apos;s</ButtonLink>
        </div>
      </Section>

      <Section title="Games">
        <p>
          Wicket&apos;s has games to suit every player, from the cozy Lantern Lake and Rooftop
          Garden to high action like Neon Rail and Freewheel (loosely based on Cyclepath).
        </p>
        <p>
          For a slower pace there are puzzle and table games: Belfry (based on Mastermind),
          Safecracker, Fireside Patience (Klondike solitaire) and Riverboat Dice (based on the dice
          game Skunk).
        </p>
        <p>
          We also have seasonal surprises in store. If you want that seasonal kick all year round,
          some seasonal games stay open: traditional hits like Winter Wonderland and Harvest Feast,
          and less traditional ones like Dragon Dance.
        </p>
      </Section>

      <Section title="Features">
        <ul>
          <li>
            Story mode, if you want it: can&apos;t decide what to play? Mabel and the rest of the
            cast take you on a tour of the parlor through a growing story. Each day brings a list
            of activities you can swap for another or skip for the day.
          </li>
          <li>Music: in some games, the music answers how you play.</li>
          <li>Unlockables: music, feats and achievements. There&apos;s always something to unlock.</li>
          <li>Tutorials: every game has an interactive tutorial. No manual required.</li>
          <li>Challenges and events: daily, weekly and monthly, for every game.</li>
          <li>Records: your best scores and runs. Online leaderboards are coming later.</li>
          <li>
            Settings: works with your screen reader, with options for each game and US or metric
            units.
          </li>
        </ul>
      </Section>

      <Section title="Platforms">
        <p>
          Version 1.1.0 is out for Windows, macOS (Apple Silicon) and Linux. Unzip and play, no
          installer required.
        </p>
        <p>
          <a href="https://github.com/orinks-games/wickets/releases">
            Wicket&apos;s releases on GitHub
          </a>
        </p>
      </Section>

      <Section title="Credits">
        <p>
          Made by Orinks, with the assistance of an agentic coder. Sound synthesis powered by
          genny and Klang.
        </p>
      </Section>
    </>
  );
}
