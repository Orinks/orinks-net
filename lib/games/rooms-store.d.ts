import type { RoomStore } from "@/lib/hearken-online";

export const SCHEMA: string[];

/** Anything with `exec(query, ...bindings)` answering a cursor, as a Durable Object's `ctx.storage.sql`. */
export interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export function sqlRooms(sql: Sql): RoomStore & { forget(): void };

export function oneAtATime(
  store: RoomStore & { forget(): void },
  service: { fetch(request: Request): Promise<Response> },
  warm?: (token: string) => Promise<unknown>,
): (request: Request) => Promise<Response>;
