// The Hearken games this site runs verified runs for. A game joins by
// adding an entry here, its handlers, and its published rules modules in
// hearken-rules/<id>/ (docs/games/hearken-online.md walks through it).
import type { Handler, Player } from "@/lib/hearken-online";
import { wicketsGame } from "@/lib/wickets-online";
import type { GameRecords } from "./records";

export type GameDefinition = {
  /** The id in the game's URL: /api/games/<id>/. */
  id: string;
  /** The game's name as players see it, on the connect page. */
  title: string;
  /** One handler per kind of run the game sends. */
  handlers(records: GameRecords): Record<string, Handler<any>>;
  /**
   * Lets players play as guests, with names the server picks. A game
   * without it has no guests. `renamed` and `linked` let its records
   * follow a guest's new name, and move to the account a guest connects.
   */
  guests?(records: GameRecords): {
    renamed?(player: Player, name: string): Promise<void>;
    linked?(input: { guest: string; player: Player | null }): Promise<void>;
  };
};

export const GAMES: Record<string, GameDefinition> = {
  wickets: wicketsGame(),
};

