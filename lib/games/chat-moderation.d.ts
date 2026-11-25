import type { ChatReport, ChatScreenInput, ChatStanding, ChatVerdict, Player } from "@/lib/hearken-online";
import type { Sql } from "./rooms-store";

export const LIMITS: Record<string, number>;
export const SCHEMA: string[];
export const ACTIONS: Record<"dismiss" | "warn" | "off-day" | "off-week" | "off-good", { outcome: string; offMs?: number | null; message?: string }>;
export const WARNING: string;
export const NOT_SENT: string;
export function hasBlockedWords(text: string): boolean;
export function hasContact(text: string): boolean;
export function offLine(until: number | null | undefined, t: number): string;

type Line = { seq: number; type: string; at: number; name?: string; text?: string };

export interface ModerationCase {
  id: number;
  about: { id: string; handle: string; name: string };
  state: "open" | "auto" | "closed";
  outcome: string | null;
  openedAt: number;
  updatedAt: number;
  closedAt: number | null;
  sanction: { chat: string; until: number | null; reason: string } | null;
  reports: {
    id: number;
    reporter: { id: string; name: string; ignored: boolean };
    counts: boolean;
    at: number;
    kind: string | null;
    room?: string | null;
    lines: Line[];
    context: Line[];
    marked: Line | null;
    note: string | null;
  }[];
  past: { id: number; outcome: string | null; closedAt: number }[];
}

export interface ChatModeration {
  screen(input: Pick<ChatScreenInput, "text" | "quick" | "player"> & Partial<ChatScreenInput>): ChatVerdict;
  report(report: ChatReport): Promise<void>;
  standing(player: Pick<Player, "id">): ChatStanding | null;
  cases(options?: { closed?: number }): ModerationCase[];
  sanctions(): { id: string; handle: string; name: string; until: number | null; reason: string }[];
  act(caseId: number, action: string): string | null;
  lift(playerId: string): void;
  ignore(reporterId: string, name: string, on: boolean): void;
}

export function chatModeration(
  sql: Sql,
  options?: { now?: () => number; mail?: ((subject: string, text: string) => Promise<void>) | null; log?: (line: string) => void; pageUrl?: string | null },
): ChatModeration;
