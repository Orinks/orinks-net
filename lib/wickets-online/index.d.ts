// Types for the copied Wicket's leaderboards (index.js). Hand-written.
import type { Handler, Player, SaveStore, SavesOptions } from "@/lib/hearken-online";
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
/** The room kinds: matches between players, by kind. */
export const ROOM_KINDS: Record<string, unknown>;
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
  saves(records: GameRecords, store: SaveStore): SavesOptions;
  guests(records: GameRecords): {
    renamed(player: Player, name: string): Promise<void>;
    linked(input: { guest: string; player: Player | null }): Promise<void>;
  };
};

/** A player's page: ranked bests from the boards, and their game's card. */
export interface WicketsProfile {
  name: string | null;
  ranked: { game: string; period: string; relaxed: boolean; score: number }[];
  card: { v: 1; games: Record<string, { best?: number; unlocks?: number }>; specials: string[]; at?: number } | null;
}
export function profile(records: GameRecords, playerId: string, options?: { now?: () => number }): Promise<WicketsProfile | null>;
export function checkCard(card: unknown): WicketsProfile["card"];
export function wicketsSaves(options: { store: SaveStore; records: GameRecords; sealed?: boolean; now?: () => number }): SavesOptions;
