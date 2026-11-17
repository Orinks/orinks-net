import { PageHeader } from "@/components/PageHeader";
import { GAMES } from "@/lib/games/registry";
import { GamesProviders } from "../connect/providers";
import { TestersGate } from "./testers-client";

// The owner's page for flagging game testers (convex/games.ts, adminSetTester).
export const metadata = {
  title: "Game testers",
  robots: { index: false, follow: false },
};

export default function GameTestersPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Game testers" />
      <GamesProviders>
        <TestersGate games={Object.values(GAMES).map((game) => ({ id: game.id, title: game.title }))} />
      </GamesProviders>
    </div>
  );
}
