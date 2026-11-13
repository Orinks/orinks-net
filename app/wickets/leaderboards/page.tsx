import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { WICKETS_RANKED_GAMES, wicketsLeaderboardsShown } from "@/lib/wickets-leaderboards";

export const metadata: Metadata = {
  title: "Wicket's Leaderboards",
  robots: { index: false },
};

// Read per request: the preview check is a Worker variable, not a build value.
export const dynamic = "force-dynamic";

export default function WicketsLeaderboardsPage() {
  if (!wicketsLeaderboardsShown()) notFound();

  return (
    <>
      <PageHeader title="Wicket's Leaderboards" intro="Sample scores." />
      <Section>
        <ul>
          {WICKETS_RANKED_GAMES.map((game) => (
            <li key={game.id}>
              <Link href={`/wickets/leaderboards/${game.id}`}>{game.name}</Link>
            </li>
          ))}
        </ul>
        <p className="mt-6">
          <Link href="/wickets">About Wicket&apos;s and its games</Link>
        </p>
      </Section>
    </>
  );
}
