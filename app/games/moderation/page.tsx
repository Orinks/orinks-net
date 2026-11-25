import { PageHeader } from "@/components/PageHeader";
import { GAMES } from "@/lib/games/registry";
import { GamesProviders } from "../connect/providers";
import { ModerationGate } from "./moderation-client";

// The owner's page for chat reports in the games' rooms
// (lib/games/chat-moderation.js, convex/gamesModeration.ts).
export const metadata = {
  title: "Chat reports",
  robots: { index: false, follow: false },
};

export default function ChatReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Chat reports" />
      <GamesProviders>
        <ModerationGate games={Object.values(GAMES).map((game) => ({ id: game.id, title: game.title }))} />
      </GamesProviders>
    </div>
  );
}
