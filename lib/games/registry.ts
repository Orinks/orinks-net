// The Hearken games this site runs verified runs for. A game joins by
// adding an entry here, its handlers, and its published rules modules in
// hearken-rules/<id>/ (docs/games/hearken-online.md walks through it).
import type { Handler } from "@/lib/hearken-online";
import type { GameRecords } from "./records";

export type GameDefinition = {
  /** The id in the game's URL: /api/games/<id>/. */
  id: string;
  /** The game's name as players see it, on the connect page. */
  title: string;
  /** One handler per kind of run the game sends. */
  handlers(records: GameRecords): Record<string, Handler<any>>;
};

export const GAMES: Record<string, GameDefinition> = {};

