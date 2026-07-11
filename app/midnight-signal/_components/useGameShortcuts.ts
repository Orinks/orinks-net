"use client";

import { useEffect, type RefObject } from "react";
import { BOSS_REWARDS, type BoostState, type Phase, type PublicQuestion } from "./gameTypes";

interface ShortcutOptions {
  enabled: boolean;
  phase: Phase;
  question: PublicQuestion | null;
  chosenIndex: number | null;
  boosts: BoostState | null;
  draftChosen: string | null;
  rewardChosen: string | null;
  holdUntil: RefObject<number>;
  replayHostClip: () => Promise<void>;
  chooseAnswer: (index: number) => Promise<void>;
  pickBoost: (key: string) => Promise<void>;
  pickReward: (key: "life" | "points" | "filter") => Promise<void>;
}

export function useGameShortcuts(options: ShortcutOptions) {
  useEffect(() => {
    if (!options.enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "r" || event.key === "R") {
        void options.replayHostClip();
        return;
      }
      if (Date.now() < options.holdUntil.current) return;
      const number = Number.parseInt(event.key, 10);
      if (options.phase.kind === "question" && options.question && options.chosenIndex === null) {
        if (number >= 1 && number <= options.question.choices.length) {
          event.preventDefault();
          void options.chooseAnswer(number - 1);
        }
      } else if (options.phase.kind === "draft" && options.boosts?.offer && options.draftChosen === null) {
        if (number >= 1 && number <= options.boosts.offer.length) {
          event.preventDefault();
          void options.pickBoost(options.boosts.offer[number - 1].key);
        }
      } else if (options.phase.kind === "bossReward" && options.rewardChosen === null) {
        if (number >= 1 && number <= BOSS_REWARDS.length) {
          event.preventDefault();
          void options.pickReward(BOSS_REWARDS[number - 1].key);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [options]);
}
