import type { Id } from "@/convex/_generated/dataModel";
import type { ClientAnswerDisclosure } from "../_lib/answerDisclosure";
import type { ClientMysteryClip } from "./MysteryClipPlayer";

export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
export const primaryButton = `inline-flex min-h-10 items-center justify-center rounded-md bg-amber-400 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-300 ${focusRing}`;
export const secondaryButton = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;

export interface PublicQuestion {
  key: string;
  category: string;
  difficulty: number;
  format: string;
  prompt: string;
  choices: string[];
  clip: ClientMysteryClip | null;
}

export interface RunState {
  runId: Id<"triviaRuns">;
  status: string;
  isDaily: boolean;
  score: number;
  round: number;
  lives: number;
  streak: number;
  answeredInRound: number;
  questionsPerRound: number;
  questionNumber: number;
  roundCategory: string | null;
  drafting: boolean;
  deadAir: boolean;
  bossCall: {
    caller: string;
    callerName: string;
    phase: "question" | "reward";
    question: PublicQuestion | null;
  } | null;
  signalStrength: number;
  mutator: { key: string; name: string; rules: string; intro: string } | null;
  dateKey: string;
  storyBeat: StoryBeatState | null;
}

export interface StoryBeatState {
  id: string;
  family: string;
  modes: Array<"regular" | "daily">;
  formats: string[];
  title: string;
  speaker: string;
  text: string;
}

export type GameEvent =
  | { type: "achievement"; key: string; name: string }
  | { type: "roundComplete"; round: number; nextCategory: string | null }
  | { type: "boostOffer" }
  | { type: "boostChosen"; key: string; name: string }
  | { type: "boostTriggered"; key: string; name: string; detail: string }
  | { type: "deadAir" }
  | { type: "deadAirSurvived" }
  | { type: "bossCall"; caller: string; name: string }
  | { type: "bossRewardChosen"; reward: string; detail: string }
  | { type: "signalGained"; strength: number }
  | { type: "lifeGained"; lives: number }
  | {
      type: "tapeUnlocked";
      id: string;
      title: string;
      order: number;
      total: number;
    }
  | { type: "finaleReady" }
  | { type: "gameOver"; score: number; round: number; isPersonalBest: boolean }
  | { type: "bankExhausted" };

export interface OwnedBoost {
  key: string;
  name: string;
  kind: string;
  rules: string;
  chargesLeft: number | null;
}

export interface OfferedBoost {
  key: string;
  name: string;
  tagline: string;
  rules: string;
  kind: string;
}

export interface BoostState {
  owned: OwnedBoost[];
  offer: OfferedBoost[] | null;
  activeRoundBoost: { key: string; round: number } | null;
  eliminatedChoices: number[];
  eliminatedBy: "static-filter" | "whisper" | null;
}

export interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string | null;
  scoreDelta: number;
  events: GameEvent[];
  run: RunState;
  boosts: BoostState;
  nextQuestion: PublicQuestion | null;
  disclosure: ClientAnswerDisclosure | null;
}

export interface CaptionLine {
  seq: number;
  speaker: string;
  text: string;
}

export interface StoryLine {
  id: string;
  title?: string;
  text: string;
}

export type Phase =
  | { kind: "title" }
  | { kind: "intro"; runNumber: number; isDaily: boolean }
  | { kind: "question" }
  | { kind: "draft" }
  | { kind: "bossReward" }
  | { kind: "feedback"; result: AnswerResult; callerContext?: string }
  | {
      kind: "tape";
      tape: StoryLine;
      pending: GameEvent[];
      result: AnswerResult;
    }
  | {
      kind: "finale";
      lines: StoryLine[];
      pending: GameEvent[];
      result: AnswerResult;
    }
  | { kind: "gameover"; result: AnswerResult };

export const BOSS_REWARDS: Array<{
  key: "life" | "points" | "filter";
  label: string;
}> = [
  {
    key: "life",
    label:
      "Extra life. One more life, effective immediately — at full lives it becomes 250 points.",
  },
  { key: "points", label: "Station credit. Plus 300 points, on the spot." },
  {
    key: "filter",
    label:
      "Static Filter charge. One more use of Static Filter — it removes two wrong choices on a question.",
  },
];

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "Mixed bag";
  return category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace("Rnb", "R&B");
}

export function formatNight(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function dailyShareText(run: RunState): string {
  const conditions = run.mutator ? ` ("${run.mutator.name}")` : "";
  return `The Midnight Signal — daily for ${formatNight(run.dateKey)}${conditions}: score ${run.score}, round ${run.round}.`;
}

export function buildStatusItems(
  run: RunState | null,
  boosts: BoostState | null,
) {
  if (!run) return [];
  const items = [
    { label: "Score", value: String(run.score) },
    { label: "Round", value: String(run.round) },
    { label: "Lives", value: run.deadAir ? "0 — dead air" : String(run.lives) },
    { label: "Streak", value: String(run.streak) },
  ];
  if (boosts && boosts.owned.length > 0) {
    items.push({
      label: "Boosts",
      value: boosts.owned
        .map((boost) =>
          boost.chargesLeft === null
            ? boost.name
            : `${boost.name}, ${boost.chargesLeft} ${boost.chargesLeft === 1 ? "use" : "uses"} left`,
        )
        .join("; "),
    });
  }
  items.push({ label: "Signal strength", value: `${run.signalStrength} of 3` });
  if (run.mutator) {
    items.push({
      label: "Conditions",
      value: `${run.mutator.name} — ${run.mutator.rules}`,
    });
  }
  return items;
}
