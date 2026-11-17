import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { anyApi } from "convex/server";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { getConvexClient } from "@/lib/convex";
import { convexRecords } from "@/lib/games/records";
import { gamesServerSecret } from "@/lib/games/stores";
import { readPlayerPage, type PlayerPage } from "@/lib/wickets-profile";
import { GamesProviders } from "@/app/games/connect/providers";
import { HidePage } from "./hide-page";
import { PlayerPageView } from "./player-page-view";

// Read per request: scores change as they are posted.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ player: string }> };

type Loaded = { page: PlayerPage } | { hidden: string } | null;

async function load(name: string): Promise<Loaded> {
  const client = getConvexClient();
  const secret = gamesServerSecret();
  if (!client || !secret) return null;
  const player = await client.query(anyApi.games.playerForPage, { secret, name });
  if (!player) return null;
  // Names are already public on the boards, so a hidden page says so,
  // which also lets its owner show it again.
  if (player.hidden) return { hidden: player.name };
  return { page: await readPlayerPage(convexRecords(client, secret, "wickets"), player, Date.now()) };
}

function decode(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const name = decode((await params).player);
  if (!name) return { robots: { index: false } };
  return { title: `${name} in Wicket's`, robots: { index: false } };
}

export default async function WicketsPlayerPage({ params }: PageProps) {
  const name = decode((await params).player);
  const loaded = name ? await load(name) : null;
  if (!loaded) notFound();
  const shown = "page" in loaded ? loaded.page.name : loaded.hidden;
  return (
    <>
      {"page" in loaded ? (
        <PlayerPageView page={loaded.page} />
      ) : (
        <>
          <PageHeader title={loaded.hidden} />
          <Section>
            <p>This player&apos;s page is hidden.</p>
          </Section>
        </>
      )}
      <GamesProviders>
        <HidePage name={shown} />
      </GamesProviders>
      <Section>
        <p>
          <Link href="/wickets/leaderboards">Wicket&apos;s leaderboards</Link>
        </p>
      </Section>
    </>
  );
}
