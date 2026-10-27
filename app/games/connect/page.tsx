import { PageHeader } from "@/components/PageHeader";
import { GAMES } from "@/lib/games/registry";
import { ConnectGate } from "./connect-client";
import { GamesProviders } from "./providers";

export const metadata = {
  title: "Connect a game",
};

export default async function ConnectGamePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  // Read on the server so the field is filled on first paint, as the
  // Freight Fate activation page does.
  const { code } = await searchParams;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Connect a game"
        intro="Enter the code your game is speaking to connect it to your orinks.net account."
      />
      <GamesProviders>
        <ConnectGate
          initialCode={code ?? ""}
          titles={Object.fromEntries(Object.values(GAMES).map((game) => [game.id, game.title]))}
        />
      </GamesProviders>
    </div>
  );
}
