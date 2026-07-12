import catalog from "../data/trivia/story-beats.json";
import { seededRandom } from "./triviaDeterminism";

export interface StoryBeat {
  id: string;
  family: string;
  modes: Array<"regular" | "daily">;
  formats: string[];
  title: string;
  speaker: string;
  text: string;
}

const beats = catalog.beats as StoryBeat[];

function shuffled(values: readonly StoryBeat[], seed: string): StoryBeat[] {
  const result = [...values].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

export function storyBeatForRound(input: {
  seed: string;
  round: number;
  isDaily: boolean;
  format?: string | null;
  contentVersion?: string;
}): StoryBeat | null {
  const mode = input.isDaily ? "daily" : "regular";
  const eligible = beats.filter((beat) => beat.modes.includes(mode));
  if (input.round < 1 || input.round > eligible.length) return null;
  const ordered = shuffled(
    eligible,
    `${input.seed}:story:${catalog.version}:${input.contentVersion ?? "current"}`,
  );
  const remaining = [...ordered];
  const selected: StoryBeat[] = [];
  for (let round = 1; round <= input.round; round += 1) {
    const affinity = round === input.round ? input.format : null;
    const preferredIndex = affinity
      ? remaining.findIndex((beat) => beat.formats.includes(affinity))
      : -1;
    const index = preferredIndex >= 0 ? preferredIndex : 0;
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected.at(-1) ?? null;
}

export function storyBeatInventory(): readonly StoryBeat[] {
  return beats;
}
