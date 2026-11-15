import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  PERIODS,
  WICKETS_RANKED_GAMES,
  wicketsBoardSource,
  wicketsLeaderboardsShown,
  type BoardPace,
} from "@/lib/wickets-leaderboards";
import { choiceFrom } from "@/lib/wickets-leaderboards/choice";
import { BoardPicker, type PickerGame } from "./board-picker";

export const metadata: Metadata = {
  title: "Wicket's Leaderboards",
  robots: { index: false },
};

// Read per request: the boards follow the current UTC period, and the
// preview check is a Worker variable, not a build value.
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function WicketsLeaderboardsPage({ searchParams }: PageProps = {}) {
  if (!wicketsLeaderboardsShown()) notFound();
  const initial = choiceFrom((await searchParams) ?? {});
  const now = Date.now();

  const games: PickerGame[] = await Promise.all(
    WICKETS_RANKED_GAMES.map(async (game) => {
      const paces: BoardPace[] = game.pace ? ["main", "relaxed"] : ["main"];
      const boards = Object.fromEntries(
        await Promise.all(
          PERIODS.map(async (period) => [
            period,
            Object.fromEntries(
              await Promise.all(
                paces.map(async (pace) => [pace, await wicketsBoardSource.board(game.id, period, pace, now)]),
              ),
            ),
          ]),
        ),
      ) as PickerGame["boards"];
      return { id: game.id, name: game.name, pace: game.pace, boards };
    }),
  );

  return (
    <>
      <PageHeader title="Wicket's Leaderboards" intro="Sample scores." />
      <Section>
        <BoardPicker games={games} initial={initial} />
        <p className="mt-8">
          <Link href="/wickets">About Wicket&apos;s and its games</Link>
        </p>
      </Section>
    </>
  );
}
