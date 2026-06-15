import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Audio Game Builds",
};

export default function AudioGameDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Audio Game Builds"
        intro="Player-facing browser builds and source links for audio game projects."
      />
      <Section title="Space Colony Defense">
        <p>
          Space Colony Defense is still experimental. Public playable builds will be listed here
          when they are ready for regular players.
        </p>
        <ul>
          <li>
            <a href="https://github.com/Orinks/space-colony-defense">Original project</a>
          </li>
          <li>
            <a href="https://github.com/nicross/syngen">Syngen on GitHub</a>
          </li>
          <li>
            <a href="https://github.com/nicross/syngen-template">Syngen template</a>
          </li>
        </ul>
        <p>
          <a href="/games">Back to Games</a>
        </p>
      </Section>
    </>
  );
}
