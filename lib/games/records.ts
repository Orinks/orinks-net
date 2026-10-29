// What a game's handlers keep from verified runs, in Convex: a JSON value
// under a collection and key, with an optional number to order the
// collection by. A board is one use; a ghost, a daily result or an unlock
// are others. Collections are per game, so games cannot see each other's.
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export type GameRecord<T = unknown> = { key: string; playerId: string | null; order: number | null; value: T };

export interface GameRecords {
  get<T = unknown>(collection: string, key: string): Promise<GameRecord<T> | null>;
  put(collection: string, key: string, record: { value: unknown; order?: number; playerId?: string }): Promise<void>;
  /**
   * Keeps the record only if its order beats the stored one (higher, or
   * lower with `ascending`), checked and written in one step. Answers
   * whether it was kept.
   */
  putBest(
    collection: string,
    key: string,
    record: { value: unknown; order: number; playerId?: string },
    options?: { ascending?: boolean },
  ): Promise<boolean>;
  /** Highest `order` first, or lowest with `ascending`. At most 100. */
  list<T = unknown>(collection: string, options?: { limit?: number; ascending?: boolean }): Promise<GameRecord<T>[]>;
  /** How many records order ahead of `order`, counting at most 1000: a rank is this plus one. */
  ahead(collection: string, order: number, options?: { ascending?: boolean }): Promise<number>;
}

export function convexRecords(client: ConvexHttpClient, secret: string, game: string): GameRecords {
  return {
    get: (collection, key) => client.query(anyApi.games.getRecord, { secret, game, collection, key }),
    async put(collection, key, record) {
      await client.mutation(anyApi.games.putRecord, {
        secret,
        game,
        collection,
        key,
        value: record.value ?? null,
        order: record.order,
        playerId: record.playerId,
        now: Date.now(),
      });
    },
    putBest: (collection, key, record, options = {}) =>
      client.mutation(anyApi.games.putBest, {
        secret,
        game,
        collection,
        key,
        value: record.value ?? null,
        order: record.order,
        playerId: record.playerId,
        ascending: options.ascending,
        now: Date.now(),
      }),
    list: (collection, options = {}) =>
      client.query(anyApi.games.listRecords, {
        secret,
        game,
        collection,
        limit: options.limit ?? 10,
        ascending: options.ascending,
      }),
    ahead: (collection, order, options = {}) =>
      client.query(anyApi.games.countAbove, { secret, game, collection, order, ascending: options.ascending }),
  };
}
