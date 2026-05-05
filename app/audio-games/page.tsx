import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Audio Games",
};

export default function AudioGamesPage() {
  return (
    <>
      <PageHeader
        title="Audio Games"
        intro="Browser-based audio game experiments built around spatial sound, keyboard play, and screen reader-friendly status updates."
      />
      <Section>
        <h2 className="text-2xl font-bold text-ink">Space Colony Defense</h2>
        <p className="mt-3 leading-7 text-slate-700">
          A playable Syngen prototype built around wave-based colony defense, spatial enemy cues,
          lane combat, and between-wave resource decisions. The hosted page explains the game,
          Syngen browser-audio limits, and the basics before linking straight into play.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/games/space-colony-defense/game.html">Play preview</ButtonLink>
          <ButtonLink href="https://github.com/Orinks/space-colony-syngen" variant="secondary">
            Syngen prototype source
          </ButtonLink>
          <ButtonLink href="https://github.com/Orinks/space-colony-defense" variant="secondary">
            Original project
          </ButtonLink>
          <ButtonLink href="https://github.com/nicross/syngen" variant="secondary">
            Syngen on GitHub
          </ButtonLink>
          <ButtonLink href="https://github.com/nicross/syngen-template" variant="secondary">
            Syngen template
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
