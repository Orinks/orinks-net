import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Wicket's",
  description: "A collection of games you play by ear, built for blind and visually impaired players. Explore action games, puzzles, relaxing activities and table games.",
};

export default function WicketsPage() {
  return (
    <>
      <PageHeader title="Wicket's" intro="A collection of games you play by ear." />
      <Section>
        <p>
          Paddle toward distant chimes on a moonlit lake. Weave through traffic in a speeding
          sci-fi skimmer. Solve a secret sequence of bells, or grow a rooftop garden whose
          plants make music together.
        </p>
        <p>
          Wicket&apos;s brings action games, puzzles, relaxing activities, and table games into
          one welcoming parlor. Built for blind and visually impaired players, it uses
          directional sound and screen-reader speech to tell you what&apos;s happening. Play
          with a keyboard or controller, with no need to see the screen.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/wickets/downloads">Download Wicket&apos;s</ButtonLink>
        </div>
      </Section>

      <Section title="Find your next game">
        <p>
          Choose a game directly from the collection. There are games that test your reactions,
          puzzles that give you time to think, and quiet places to explore.
        </p>
        <ul>
          <li><strong>Lantern Lake:</strong> Paddle a canoe toward lanterns you locate by their
            chimes. Each lantern adds another instrument to the music. Explore the shoreline
            and record discoveries in your journal, with no timer or way to fail.</li>
          <li><strong>Neon Rail: Black Sky Run:</strong> Pilot a skimmer along three lanes through
            Black Sky City. Listen for approaching traffic, dodge debris, shoot drones, and
            time your boost to break through blockades. Choose routes and upgrades between
            sectors as you try to reach extraction.</li>
          <li><strong>Rooftop Garden:</strong> Plant seeds, water dry soil, remove pests, and
            harvest what you grow. Each kind of plant contributes a different musical part.
            Keep them healthy together to hear the full garden chorus.</li>
          <li><strong>Belfry:</strong> Deduce a secret sequence of four bells. Each guess tells
            you how many bells are correct and how many belong somewhere else in the sequence.
            Use that feedback to solve the puzzle within ten guesses, without a time limit.</li>
          <li><strong>Freewheel:</strong> Ride a bicycle through city traffic, listening for the
            vehicles around you.</li>
          <li><strong>Riverboat Dice:</strong> Decide whether to roll again or bank your total
            before a 1 puts your gains at risk.</li>
          <li><strong>Fireside Patience:</strong> Settle down by the fire for Klondike solitaire,
            with deals that can always be won.</li>
        </ul>
        <p>
          There&apos;s more to explore: navigate a submarine by sonar, balance on a tightrope,
          land on distant moons, collect creatures for an aquarium, or answer birds by singing
          their songs back.
        </p>
      </Section>

      <Section title="Bring the parlor back to life">
        <p>
          The optional story puts you in the role of a new keeper at a parlor that has been dark
          for twelve years. Meet Mabel and the other regulars as you bring its games back into use.
        </p>
        <p>
          Each sitting offers a selection of games suited to the time of day and season.
          Complete an activity to light its lamp in the Long Hall and uncover more of the story.
          You can swap or skip suggestions, and set preferences for the games you want included.
        </p>
        <p>
          If you&apos;d rather choose your own games, head straight to Play. Some additional
          games unlock as the story progresses.
        </p>
      </Section>

      <Section title="Learn by playing">
        <p>
          Interactive tutorials let you try the controls as you learn. Sound checks introduce
          important cues and explain what they mean, so you can practise recognizing them
          before a run.
        </p>
        <p>
          During play, you can ask for your status, repeat speech, request a hint, or open help.
          Controls can be reassigned in Settings, and spoken instructions follow your chosen bindings.
        </p>
      </Section>

      <Section title="Something to return to">
        <p>
          Daily, weekly, and monthly challenges give familiar games new goals and variations.
          Track your personal bests and challenge streaks, earn achievements, and unlock music
          as you play.
        </p>
        <p>
          In Lantern Lake and Rooftop Garden, your actions help create the soundtrack: gathering
          lanterns adds instruments, while healthy plants combine into musical harmonies.
        </p>
      </Section>

      <Section title="A parlor that follows the seasons">
        <p>
          Holiday games include running a Thanksgiving kitchen, sorting gifts by sound, leading
          a dragon dance, and climbing a haunted house.
        </p>
        <p>
          The regular seasonal games remain playable throughout the year, with extra activities
          around their holidays. Other games change on special dates, from full moons to meteor
          showers. The lobby&apos;s <strong>Happening today</strong> list tells you what&apos;s
          available when you visit.
        </p>
      </Section>

      <Section title="Download and play">
        <p>
          Wicket&apos;s is free for noncommercial use and available for <strong>Windows, macOS
          on Apple Silicon, and Linux</strong>.
        </p>
        <p>Download the package for your system, unpack it, and open the game.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/wickets/downloads">Download Wicket&apos;s</ButtonLink>
        </div>
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
