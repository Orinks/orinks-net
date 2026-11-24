// Types for the copied @hearken/online library (index.js). Hand-written:
// the library itself is plain JavaScript.

export const ABI: number;
export const MAX_RUN_BYTES: number;
export const KIND_PATTERN: RegExp;

export class RulesError extends Error {
  code: string;
  constructor(code: string, message?: string);
}

export class Refusal extends Error {
  code: string;
  constructor(code: string, message?: string);
}

/** Refuses a run in the handler's own words: 422 { error: code, message }. */
export function refuse(code: string, message?: string): Refusal;

export function buildOf(run: Uint8Array): string | null;
export function sha256Hex(bytes: Uint8Array): Promise<string>;

export interface Rules {
  build: string;
  names: string[];
}

export function loadRules(bytes: Uint8Array, options?: { build?: string }): Promise<Rules>;

export interface PublishedRules {
  get(build: string): Promise<Rules | null>;
  builds(): Promise<string[]>;
  /** The first published module that has these rules and plays matches. */
  forRules?(name: string): Promise<Rules | null>;
}

export function publishedRules(
  list: ({ bytes: Uint8Array; build?: string } | { module: WebAssembly.Module; build: string })[],
): PublishedRules;

export interface Player {
  id: string;
  name: string;
  /** A guest: no account, a name the server picked. */
  guest?: boolean;
}

export const GUEST_ADJECTIVES: readonly string[];
export const GUEST_NOUNS: readonly string[];
/** A name such as "Copper Fox 12", from the word lists. */
export function guestName(): string;
export function isGuestName(name: unknown): boolean;

/** What a run file says about itself, before it is verified. */
export interface RunInfo {
  ok: true;
  run_id: string;
  build: string;
  rules: string;
  seed: string;
  context: unknown;
  ticks: number;
}

export interface Expected {
  rules: string;
  seed: string | number | bigint;
  context?: unknown;
  [extra: string]: unknown;
}

export interface Verified<Outcome = unknown> {
  ok: true;
  run_id: string;
  rules: string;
  build: string;
  seed: string;
  ticks: number;
  outcome: Outcome;
}

export interface Handler<Outcome = unknown> {
  /** "allow" lets two players send the same run file. */
  copies?: "allow";
  start?(input: { kind: string; player: Player }): Promise<{ seed: string | number | bigint; context?: unknown; [extra: string]: unknown }>;
  expect(input: { kind: string; player: Player; run: RunInfo }): Promise<Expected> | Expected;
  accept(input: {
    kind: string;
    player: Player;
    verified: Verified<Outcome>;
    run: RunInfo;
    expected: Expected;
  }): Promise<unknown> | unknown;
  read?(input: { request: Request; kind: string; path: string[]; player: Player | null }): Promise<unknown> | unknown;
}

export interface Accounts {
  player(token: string): Promise<Player | null>;
  startActivation(input: { clientKey: string; machine?: string; guest?: Player }): Promise<{
    device_code: string;
    user_code: string;
    verify_url?: string;
    verify_url_complete?: string;
    expires_in: number;
    interval: number;
  }>;
  pollActivation(deviceCode: string): Promise<
    | { status: "pending" }
    | { status: "expired" }
    /** `linked`: the guest this account took over, whose tokens no longer work. */
    | { status: "ready"; token: string; name?: string | null; linked?: string }
  >;
  /** A new guest. Without it, the service has no guests. */
  createGuest?(input: { clientKey: string }): Promise<{ token: string; name: string; player: Player }>;
  /** Another name for a guest, or null for a player who is not one. */
  renameGuest?(player: Player): Promise<string | null>;
}

export type Claim = { claimed: true; nonce: string } | { claimed: false; existing?: { player?: string; reply?: unknown } };

export interface Runs {
  claim(key: string, record: { player: string; kind: string }): Promise<Claim>;
  complete(key: string, claim: Claim, reply: unknown): Promise<void>;
  release(key: string, claim: Claim): Promise<void>;
}

export interface Limiter {
  allow(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface ServiceOptions {
  rules: { get(build: string): Promise<Rules | null> };
  accounts: Accounts;
  runs: Runs;
  limiter: Limiter;
  handlers: Record<string, Handler<any>>;
  basePath?: string;
  replay?: (rules: Rules, run: Uint8Array, expected: Expected) => Promise<unknown>;
  clientKey?: (request: Request) => string;
  log?: (event: object) => void;
  /** A guest connected an account: move the guest's results to it. */
  onLink?: (input: { guest: string; player: Player | null }) => Promise<void>;
  /** Synced files: a sealed copy of each player's save (saves.js). */
  saves?: SavesOptions | null;
  /** Matches and chat between players (rooms.js). Without it the rooms routes answer 404. */
  rooms?: RoomStore | null;
  /** A secret mixed into every player's handle in rooms. */
  handleKey?: string;
  limits?: Partial<{
    runsPerMinute: number;
    activationsPerMinute: number;
    pollsPerMinute: number;
    guestsPerDay: number;
    renamesPerHour: number;
    savesPerHour: number;
    saveReadsPerHour: number;
  }>;
}

export function createService(options: ServiceOptions): { fetch(request: Request): Promise<Response> };

/** One kept revision of a synced file, as a store answers `head`. */
export interface SaveHead {
  revision: number;
  hash: string;
  bytes: number;
  format: number;
  at: number;
}

export interface SaveStore {
  head(player: string, name: string): Promise<SaveHead | null>;
  read(player: string, name: string): Promise<(SaveHead & { content: Uint8Array }) | null>;
  /** The base check and the new revision must be one transaction. */
  write(
    player: string,
    name: string,
    save: { base: number; format: number; hash: string; content: Uint8Array; bytes: number; at: number },
  ): Promise<{ revision: number; stale?: boolean }>;
}

export interface SavesOptions {
  store: SaveStore;
  files: Record<string, { maxBytes?: number; sealed?: boolean; card?: (card: unknown, input: { player: Player }) => unknown }>;
  guests?: boolean;
  onSave?: (input: { player: Player; name: string; revision: number; card: unknown }) => Promise<void>;
}

export const SAVE_NAME_PATTERN: RegExp;
export const MAX_SAVE_BYTES: number;
export const KEEP_REVISIONS: number;
export const MAX_CARD_BYTES: number;
export function memorySaves(options?: { keep?: number }): SaveStore & {
  revisions(player: string, name: string): Promise<number[]>;
  purge(player: string): Promise<void>;
};

/**
 * Where rooms and their events live (rooms.js, memoryRooms, and
 * lib/games/rooms-store.js). Rooms are plain records the service reads,
 * changes and saves.
 */
export interface RoomStore {
  create(room: object): Promise<any>;
  get(id: string): Promise<any | null>;
  save(room: object): Promise<void>;
  byCode(code: string): Promise<any | null>;
  byName(kind: string, name: string): Promise<any | null>;
  directBetween(kind: string, a: string, b: string): Promise<any | null>;
  listFor(playerId: string): Promise<any[]>;
  openRooms(kind: string): Promise<any[]>;
  append(id: string, event: object): Promise<number>;
  eventsAfter(id: string, seq: number, limit?: number): Promise<any[]>;
  eventsBefore(id: string, seq: number | null, limit?: number): Promise<any[]>;
  prune(id: string, beforeAt: number): Promise<void>;
  rememberPlayer(player: object): Promise<void>;
  playerByHandle(handle: string): Promise<any | null>;
  relations(playerId: string): Promise<{ muted: Set<string>; blocked: Set<string>; blockedBy: Set<string> }>;
  setMute(player: object, handle: string, mode: string, them?: object | null): Promise<void>;
}

export function memoryRooms(): RoomStore;
export function memoryLimiter(options?: { now?: () => number }): Limiter;
export const FINAL_PHASES: string[];
export const PHASES: string[];
export function mintRoomCode(): string;
