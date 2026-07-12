export interface SeededRun {
  isDaily: boolean;
  seed: string;
}

/** UTC calendar date used by daily broadcasts and their leaderboards. */
export function dateKeyOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** ISO 8601 week, e.g. "2026-W27". Weeks start Monday. */
export function weekKeyOf(now: number): string {
  const date = new Date(now);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Small deterministic PRNG used for persisted daily episode decisions. */
export function seededRandom(seedText: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index++) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function difficultyRange(round: number): [number, number] {
  if (round <= 2) return [1, 2];
  if (round <= 4) return [1, 3];
  if (round <= 7) return [2, 4];
  return [3, 5];
}

export function runRoll(
  run: SeededRun,
  salt: string,
  random: () => number = Math.random,
): number {
  return run.isDaily ? seededRandom(`${run.seed}:${salt}`)() : random();
}
