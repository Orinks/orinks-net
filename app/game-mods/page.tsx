import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Game Mods",
};

export default function GameModsPage() {
  return (
    <>
      <PageHeader title="Game Mods" intro="Mods that change existing games, including Eurofly Enhanced Mod." />
      <Section>
        <h2>
          <Link href="/eurofly-enhanced-mod">Eurofly Enhanced Mod</Link>
        </h2>
        <p>Changes Eurofly&apos;s menu voice, alerts, reverser tone, and aircraft-system text.</p>
      </Section>
    </>
  );
}
