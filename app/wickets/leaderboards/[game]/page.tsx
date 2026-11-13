import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  PERIODS,
  wicketsBoardSource,
  wicketsLeaderboardsShown,
  wicketsRankedGame,
  type BoardPace,
  type Period,
} from "@/lib/wickets-leaderboards";
import { BoardTable } from "../board-table";

type GamePageProps = { params: Promise<{ game: string }> };

const HEADINGS: Record<Period, string> = { daily: "Today", weekly: "This week", monthly: "This month" };
const CHALLENGES: Record<Period, string> = {
  daily: "Daily challenge",
  weekly: "Weekly challenge",
  monthly: "Monthly challenge",
};
const PACES: Record<BoardPace, string> = { main: "Normal and Quick pace", relaxed: "Relaxed pace" };

// Read per request: the boards follow the current UTC period, and the
// preview check is a Worker variable, not a build value.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const game = wicketsRankedGame((await params).game);
  return { title: game ? `${game.name} Leaderboards - Wicket's` : "Wicket's Leaderboards", robots: { index: false } };
}

export default async function WicketsGameLeaderboardsPage({ params }: GamePageProps) {
  if (!wicketsLeaderboardsShown()) notFound();
  const game = wicketsRankedGame((await params).game);
  if (!game) notFound();
  const now = Date.now();

  const paces: BoardPace[] = game.pace ? ["main", "relaxed"] : ["main"];
  const periods = await Promise.all(
    PERIODS.map(async (period) => ({
      period,
      boards: await Promise.all(
        paces.map(async (pace) => ({ pace, board: await wicketsBoardSource.board(game.id, period, pace, now) })),
      ),
    })),
  );

  return (
    <>
      <PageHeader title={`${game.name} Leaderboards`} intro="Sample scores." />
      {periods.map(({ period, boards }) => (
        <Section key={period} title={HEADINGS[period]}>
          {boards.map(({ pace, board }) =>
            game.pace ? (
              <div key={pace}>
                <h3>{PACES[pace]}</h3>
                <BoardTable board={board} caption={`${CHALLENGES[period]}, ${PACES[pace]}`} />
              </div>
            ) : (
              <BoardTable board={board} caption={CHALLENGES[period]} key={pace} />
            ),
          )}
        </Section>
      ))}
      <Section>
        <p>
          <Link href="/wickets/leaderboards">Back to Wicket&apos;s leaderboards</Link>
        </p>
      </Section>
    </>
  );
}
