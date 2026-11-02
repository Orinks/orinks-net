import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Game Mods",
};

export default function GameModsPage() {
  return (
    <>
      <PageHeader title="Game Mods" intro="Game mods by Orinks." />
      <Section>
        <h2>
          <Link href="/eurofly-enhanced-mod">Eurofly Enhanced Mod</Link>
        </h2>
        <p>Changes to the Eurofly flight simulator.</p>
      </Section>
    </>
  );
}
