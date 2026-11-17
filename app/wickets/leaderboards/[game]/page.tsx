import { notFound, redirect } from "next/navigation";
import { wicketsRankedGame } from "@/lib/wickets-leaderboards";

type GamePageProps = { params: Promise<{ game: string }> };

export const dynamic = "force-dynamic";

/** The old page per game: its board is on the one page now. */
export default async function WicketsGameLeaderboardsPage({ params }: GamePageProps) {
  const game = wicketsRankedGame((await params).game);
  if (!game) notFound();
  redirect(`/wickets/leaderboards?game=${game.id}`);
}
