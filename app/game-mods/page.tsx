import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Game Mods",
};

export default function GameModsPage() {
  return (
    <>
      <PageHeader title="Game Mods" intro="Accessible game mods by Orinks." />
      <Section>
        <h2>
          <Link href="/eurofly-enhanced-mod">Eurofly Enhanced Mod</Link>
        </h2>
        <p>An enhanced accessibility mod for the Eurofly audio game.</p>
      </Section>
    </>
  );
}
