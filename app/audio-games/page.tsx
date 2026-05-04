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
          A production-minded Syngen prototype is being planned around wave-based colony defense,
          spatial enemy cues, and between-wave resource decisions. The source stays in a standalone
          game project, while orinks.net hosts playable web builds for preview and testing.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/games/space-colony-defense/index.html">Play preview</ButtonLink>
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
