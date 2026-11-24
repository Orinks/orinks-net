import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  PERIODS,
  WICKETS_RANKED_GAMES,
  onLiveSite,
  wicketsBoardSource,
  type BoardPace,
} from "@/lib/wickets-leaderboards";
import { liveBoards } from "@/lib/wickets-leaderboards/live";
import { ALL_GAMES, choiceFrom } from "@/lib/wickets-leaderboards/choice";
import { BoardPicker, type PickerGame } from "./board-picker";

export const metadata: Metadata = {
  title: "Wicket's Leaderboards",
  description: "The daily, weekly and monthly challenge leaderboards for Wicket's.",
};

// Read per request: the boards follow the current UTC period, and the
// preview check is a Worker variable, not a build value.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function WicketsLeaderboardsPage({ searchParams }: PageProps) {
  const initial = choiceFrom((await searchParams) ?? {});
  const now = Date.now();
  const live = onLiveSite();
  // The live site reads the board shown (every game's main board for the
  // overview), and the page reads others as they are chosen; the preview
  // has no backend and shows every sample board.
  const source = live ? liveBoards() : wicketsBoardSource;

  if (!source) {
    return (
      <>
        <PageHeader title="Wicket's Leaderboards" />
        <Section>
          <p>The leaderboards are unavailable right now. Try again later.</p>
        </Section>
      </>
    );
  }

  const games: PickerGame[] = await Promise.all(
    WICKETS_RANKED_GAMES.map(async (game) => {
      const paces: BoardPace[] = game.pace ? ["main", "relaxed"] : ["main"];
      const boards = Object.fromEntries(
        await Promise.all(
          PERIODS.map(async (period) => [
            period,
            Object.fromEntries(
              await Promise.all(
                paces
                  .filter(
                    (pace) =>
                      !live ||
                      (period === initial.period &&
                        (initial.game === ALL_GAMES ? pace === "main" : game.id === initial.game && pace === initial.pace)),
                  )
                  .map(async (pace) => [pace, await source.board(game.id, period, pace, now)]),
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
      <PageHeader title="Wicket's Leaderboards" intro={live ? undefined : "Sample scores."} />
      <Section>
        <BoardPicker games={games} initial={initial} />
        <p className="mt-8">
          <Link href="/wickets">About Wicket&apos;s and its games</Link>
        </p>
      </Section>
    </>
  );
}
