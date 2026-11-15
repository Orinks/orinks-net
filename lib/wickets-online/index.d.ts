// Types for the copied Wicket's leaderboards (index.js). Hand-written.
import type { Handler, Player } from "@/lib/hearken-online";
import type { GameRecords } from "@/lib/games/records";

export interface Boards {
  record(
    board: string,
    entry: { player: string; name?: string; score: number; at: number; since?: number; run?: string; held?: boolean },
    rule: "first" | "best",
  ): Promise<{ counted: boolean; entry: unknown }>;
  top(
    board: string,
    n: number,
    playerId?: string,
  ): Promise<{
    entries: { rank: number; name: string; score: number }[];
    of: number;
    you: { rank: number | null; score: number; held: boolean } | null;
  }>;
  rename(playerId: string, name: string): Promise<void>;
  move(fromId: string, toId: string, toName: string): Promise<void>;
}

export const GAMES: Record<string, unknown>;
export const GRACE_MS: number;
export const TOP: number;
export function recordsBoards(records: GameRecords): Boards;
export function memoryBoards(): Boards;
export function memoryRecords(): GameRecords;
export function secretSeed(secret: string, text: string): Promise<string>;
export function wicketsHandlers(options: {
  boards: Boards;
  secret: string;
  now?: () => number;
  games?: Record<string, unknown>;
}): Record<string, Handler<any>>;
export function wicketsGame(options?: { secret?: string; now?: () => number; games?: Record<string, unknown> }): {
  id: string;
  title: string;
  handlers(records: GameRecords): Record<string, Handler<any>>;
  guests(records: GameRecords): {
    renamed(player: Player, name: string): Promise<void>;
    linked(input: { guest: string; player: Player | null }): Promise<void>;
  };
};
